"""Test authentication with a fake CLI. No AWS requests or browser logins occur."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MOCK = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["MOCK_LOG"], "a") as log:
    log.write(json.dumps(args) + "\\n")
if args[:2] == ["configure", "list-profiles"]:
    print(os.environ.get("MOCK_PROFILES", "default\\nbarnaba\\nstatic"))
elif args[:2] == ["configure", "get"]:
    if "static" in args or args[2] != "sso_session":
        sys.exit(1)
    print("shared-session")
elif args[:2] == ["configure", "export-credentials"]:
    if os.environ.get("MOCK_EXPECT_CA") and os.environ.get("AWS_CA_BUNDLE") != os.environ["MOCK_EXPECT_CA"]:
        print("Missing custom CA", file=sys.stderr)
        sys.exit(1)
    mode = os.environ.get("MOCK_MODE", "valid")
    if mode != "valid" and not Path(os.environ["MOCK_LOGIN"]).exists():
        errors = {
            "expired": "The SSO session associated with this profile has expired or is otherwise invalid.",
            "missing": "Error loading SSO Token: Token for shared-session does not exist",
            "refresh": "Error when retrieving token from sso: Token has expired and refresh failed",
            "network": "Could not connect to the endpoint URL",
            "denied": "An error occurred (AccessDeniedException) when calling GetRoleCredentials",
        }
        print(errors[mode], file=sys.stderr)
        sys.exit(1)
    print('{"SecretAccessKey":"DO_NOT_PRINT"}')
elif args[:2] == ["sso", "login"]:
    print("Browser login flow")
    if os.environ.get("MOCK_LOGIN_FAIL"):
        sys.exit(9)
    Path(os.environ["MOCK_LOGIN"]).touch()
else:
    print(json.dumps({"args": args, "profile": os.environ.get("AWS_PROFILE"), "key": os.environ.get("AWS_ACCESS_KEY_ID"), "ca": os.environ.get("AWS_CA_BUNDLE")}))
    sys.exit(int(os.environ.get("MOCK_COMMAND_EXIT", "0")))
'''


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        scripts = self.home / "dotfiles/scripts"
        scripts.mkdir(parents=True)
        for name in ("aws-sso-check.sh", "aws-shell.zsh"):
            shutil.copy2(ROOT / "scripts" / name, scripts / name)
        binary = self.home / "bin"
        binary.mkdir()
        aws = binary / "aws"
        aws.write_text(MOCK)
        aws.chmod(0o755)
        self.log = self.home / "calls"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("AWS_") and k != "CI"}
        self.env.update(HOME=str(self.home), PATH=f"{binary}:/usr/bin:/bin",
                        MOCK_LOG=str(self.log), MOCK_LOGIN=str(self.home / "logged-in"))
        self.source = 'source "$HOME/dotfiles/scripts/aws-shell.zsh"; '

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def run_shell(self, code, **env):
        return subprocess.run(["/bin/zsh", "-f", "-c", self.source + code],
                              env=self.env | env, capture_output=True, text=True, timeout=10)

    def test_source_does_not_contact_aws(self):
        self.assertEqual(self.run_shell("true").returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_reload_replaces_legacy_alias(self):
        result = self.run_shell('alias awscheck="echo legacy"; source "$HOME/dotfiles/scripts/aws-shell.zsh"; whence -w awscheck')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "awscheck: function")
        self.assertEqual(self.calls(), [])

    def test_valid_credentials_are_private_and_arguments_unchanged(self):
        result = self.run_shell('aws sts get-caller-identity --query "a b" --output json')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("DO_NOT_PRINT", result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["args"],
                         ["sts", "get-caller-identity", "--query", "a b", "--output", "json"])
        self.assertEqual(result.stderr, "")

    def test_explicit_profile_reaches_every_check(self):
        result = self.run_shell('aws sts get-caller-identity --profile barnaba')
        self.assertEqual(result.returncode, 0, result.stderr)
        checks = [a for a in self.calls() if a[:2] in [["configure", "get"], ["configure", "export-credentials"]]]
        self.assertTrue(checks)
        self.assertTrue(all(a[a.index("--profile") + 1] == "barnaba" for a in checks))

    def test_profile_equals(self):
        result = self.run_shell('aws --profile=barnaba sts get-caller-identity')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(["configure", "get", "sso_session", "--profile", "barnaba"], self.calls())

    def test_environment_credentials_bypass_sso(self):
        result = self.run_shell('aws sts get-caller-identity', AWS_ACCESS_KEY_ID="test")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(self.calls()), 1)

    def test_explicit_profile_overrides_environment_credentials(self):
        result = self.run_shell('aws --profile barnaba sts get-caller-identity', AWS_ACCESS_KEY_ID="test")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(any(a[:2] == ["configure", "export-credentials"] for a in self.calls()))

    def test_missing_profile_does_not_run_command(self):
        result = self.run_shell('aws --profile unknown sts get-caller-identity')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("profile not found", result.stderr)
        self.assertFalse(any("sts" in a for a in self.calls()))

    def test_non_sso_profile_does_not_login(self):
        self.assertEqual(self.run_shell('aws --profile static sts get-caller-identity').returncode, 0)
        self.assertFalse(any(a[:2] == ["sso", "login"] for a in self.calls()))

    def test_noninteractive_expiry_never_opens_browser_or_runs_operation(self):
        for mode in ("expired", "missing", "refresh"):
            with self.subTest(mode=mode):
                self.log.unlink(missing_ok=True)
                result = self.run_shell('aws sts get-caller-identity', MOCK_MODE=mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("SSO sign-in required", result.stderr)
                self.assertFalse(any(a[:2] == ["sso", "login"] or "sts" in a for a in self.calls()))

    def test_other_errors_do_not_login(self):
        for mode in ("network", "denied"):
            with self.subTest(mode=mode):
                self.log.unlink(missing_ok=True)
                result = self.run_shell('aws sts get-caller-identity', MOCK_MODE=mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SSO sign-in required", result.stderr)
                self.assertFalse(any(a[:2] == ["sso", "login"] for a in self.calls()))

    def test_help_config_and_unsigned_commands_bypass_preflight(self):
        for args in ('--version', 'help', 'configure list-profiles', 'sso logout',
                     's3 ls --no-sign-request',
                     'ec2 run-instances --generate-cli-skeleton input'):
            with self.subTest(args=args):
                self.log.unlink(missing_ok=True)
                self.assertEqual(self.run_shell('aws ' + args).returncode, 0)
                self.assertEqual(len(self.calls()), 1)

    def test_operations_are_not_retried(self):
        result = self.run_shell('aws ec2 run-instances', MOCK_COMMAND_EXIT="42")
        self.assertEqual(result.returncode, 42)
        self.assertEqual(self.calls().count(["ec2", "run-instances"]), 1)

    def test_awsrun_passes_profile_without_leaking_it_to_shell(self):
        result = self.run_shell('awsrun -p barnaba aws sts get-caller-identity; print "after:${AWS_PROFILE-unset}"')
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        self.assertEqual(json.loads(lines[0])["profile"], "barnaba")
        self.assertEqual(lines[1], "after:unset")

    def test_awsrun_explicit_profile_removes_environment_credentials(self):
        result = self.run_shell('awsrun -p barnaba aws sts get-caller-identity',
                                AWS_ACCESS_KEY_ID="other-account", AWS_SECRET_ACCESS_KEY="secret",
                                AWS_SESSION_TOKEN="token")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(json.loads(result.stdout)["key"])
        self.assertEqual(json.loads(result.stdout)["profile"], "barnaba")

    def test_profileless_provider_is_left_to_aws(self):
        result = self.run_shell('aws sts get-caller-identity', MOCK_PROFILES="")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls()[-1], ["sts", "get-caller-identity"])

    def test_help_argument_value_and_custom_endpoint_do_not_bypass(self):
        for args in ('ssm get-parameter --name help',
                     's3 ls --endpoint-url https://s3.us-east-1.amazonaws.com'):
            with self.subTest(args=args):
                self.log.unlink(missing_ok=True)
                result = self.run_shell('aws ' + args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(any(a[:2] == ["configure", "export-credentials"] for a in self.calls()))

    def test_custom_ca_reaches_preflight_and_command(self):
        result = self.run_shell('aws --ca-bundle /tmp/custom.pem sts get-caller-identity',
                                MOCK_EXPECT_CA="/tmp/custom.pem")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["ca"], "/tmp/custom.pem")

    def test_missing_arguments(self):
        for code in ('awsrun', 'awsrun -p', 'awsrun -p -- aws',
                     '"$HOME/dotfiles/scripts/aws-sso-check.sh" -p'):
            with self.subTest(code=code):
                self.assertEqual(self.run_shell(code).returncode, 2)

    def run_tty(self, mode="expired", interactive=True, **env):
        pid, fd = pty.fork()
        if pid == 0:
            flags = ["-f", "-i", "-c"] if interactive else ["-f", "-c"]
            os.execve("/bin/zsh", ["zsh"] + flags + [self.source + 'aws sts get-caller-identity'],
                      self.env | {"MOCK_MODE": mode} | env)
        output = b""
        try:
            while True:
                if not select.select([fd], [], [], 10)[0]:
                    os.kill(pid, 9)
                    self.fail("TTY authentication timed out")
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output += chunk
        finally:
            os.close(fd)
            _, status = os.waitpid(pid, 0)
        return os.waitstatus_to_exitcode(status), output.decode()

    def test_interactive_login_then_execute_once(self):
        code, output = self.run_tty()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.calls().count(["sso", "login", "--profile", "default"]), 1)
        self.assertEqual(self.calls().count(["sts", "get-caller-identity"]), 1)
        self.assertNotIn("DO_NOT_PRINT", output)

    def test_login_failure_stops_operation(self):
        code, output = self.run_tty(MOCK_LOGIN_FAIL="1")
        self.assertEqual(code, 9, output)
        self.assertFalse(any("sts" in a for a in self.calls()))

    def test_agent_with_tty_never_logs_in(self):
        code, output = self.run_tty(interactive=False)
        self.assertNotEqual(code, 0)
        self.assertIn("SSO sign-in required", output)
        self.assertFalse(any(a[:2] == ["sso", "login"] for a in self.calls()))

    def test_ci_with_tty_never_logs_in(self):
        code, output = self.run_tty(CI="true")
        self.assertNotEqual(code, 0)
        self.assertIn("SSO sign-in required", output)
        self.assertFalse(any(a[:2] == ["sso", "login"] for a in self.calls()))


if __name__ == "__main__":
    unittest.main()
