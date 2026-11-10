#!/usr/bin/env bash
# Resolve credentials before a command. Never print or export credential values.
set -euo pipefail

profile="${AWS_PROFILE:-${AWS_DEFAULT_PROFILE:-default}}"
quiet=false
allow_login=false
explicit_profile=false

usage() {
    echo "Usage: awscheck [-p|--profile NAME] [-q|--quiet] [--login|--check-only]"
    echo "Refresh SSO credentials. --login permits browser sign-in in a terminal."
    echo "By default, never open a browser. --quiet suppresses success messages."
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--profile)
            if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
                echo "Missing profile name." >&2
                exit 2
            fi
            profile="$2"
            explicit_profile=true
            shift 2
            ;;
        -q|--quiet) quiet=true; shift ;;
        --login) allow_login=true; shift ;;
        --check-only) allow_login=false; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

# Environment credentials take precedence unless --profile is explicit.
if [[ "$explicit_profile" == false && -n "${AWS_ACCESS_KEY_ID:-}" ]]; then
    exit 0
fi

export AWS_PAGER="" AWS_CLI_AUTO_PROMPT=off

# Leave non-SSO credential providers to the CLI or SDK. Missing profiles are errors.
if ! command aws configure list-profiles | grep -Fxq -- "$profile"; then
    # A profileless provider chain can use EC2/ECS roles or web identity.
    if [[ "$explicit_profile" == false && -z "${AWS_PROFILE:-}${AWS_DEFAULT_PROFILE:-}" ]]; then
        exit 0
    fi
    echo "AWS profile not found: $profile" >&2
    exit 1
fi
session=$(command aws configure get sso_session --profile "$profile" 2>/dev/null || true)
start_url=$(command aws configure get sso_start_url --profile "$profile" 2>/dev/null || true)
if [[ -z "$session" && -z "$start_url" ]]; then
    [[ "$quiet" == true ]] || echo "Profile '$profile' does not use SSO; no SSO check needed." >&2
    exit 0
fi

resolve_credentials() {
    # Discard stdout before capturing stderr: stdout contains secret credentials.
    # shellcheck disable=SC2069
    command aws configure export-credentials --profile "$profile" --format process \
        --cli-connect-timeout 5 --cli-read-timeout 10 2>&1 >/dev/null
}

if error=$(resolve_credentials); then
    [[ "$quiet" == true ]] || echo "AWS credentials are ready for '$profile'." >&2
    exit 0
fi

# Network, permission, and configuration failures must not trigger a login.
case "$error" in
    *"SSO session"*expired*|*"Error loading SSO Token"*"does not exist"*|*"Error when retrieving token from sso: Token has expired"*|*UnauthorizedSSOTokenError*) ;;
    *) printf '%s\n' "$error" >&2; exit 1 ;;
esac

if [[ "$allow_login" == false || ! -t 0 || ! -t 2 || -n "${CI:-}" ]]; then
    echo "AWS SSO sign-in required for '$profile'. Run: aws sso login --profile $profile" >&2
    exit 1
fi

echo "AWS SSO session expired for '$profile'; opening sign-in." >&2
# Keep browser-flow text away from command stdout (for JSON output and pipes).
command aws sso login --profile "$profile" >&2
if ! error=$(resolve_credentials); then
    printf '%s\n' "$error" >&2
    exit 1
fi
[[ "$quiet" == true ]] || echo "AWS credentials are ready for '$profile'." >&2
exit 0
