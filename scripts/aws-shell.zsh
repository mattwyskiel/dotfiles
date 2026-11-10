# Source from Zsh. Loading this file does not contact AWS.

# Remove the old alias when an existing terminal reloads its configuration.
unalias awscheck 2>/dev/null || true

awscheck() {
    local -a login_args
    login_args=()
    # A PTY alone is not proof of a human session: agents also use PTYs.
    [[ ! -o interactive ]] || login_args=(--login)
    "$HOME/dotfiles/scripts/aws-sso-check.sh" "${login_args[@]}" "$@"
}

aws() {
    local -a original profile_args
    original=("$@")
    profile_args=()
    local service="" bypass=false

    # Read global flags without changing the command that will run.
    while (( $# )); do
        case "$1" in
            --profile)
                (( $# >= 2 )) || { command aws "${original[@]}"; return $?; }
                profile_args=(--profile "$2")
                shift 2
                ;;
            --profile=*) profile_args=(--profile "${1#*=}"); shift ;;
            --help|--version|--no-sign-request|--generate-cli-skeleton|--generate-cli-skeleton=*)
                bypass=true; shift ;;
            --ca-bundle)
                (( $# >= 2 )) || { command aws "${original[@]}"; return $?; }
                local -x AWS_CA_BUNDLE="$2"
                shift 2
                ;;
            --ca-bundle=*) local -x AWS_CA_BUNDLE="${1#*=}"; shift ;;
            --region|--output|--query|--color|--endpoint-url|--cli-read-timeout|--cli-connect-timeout|--cli-binary-format|--cli-error-format)
                (( $# >= 2 )) || { command aws "${original[@]}"; return $?; }
                shift 2
                ;;
            -*) shift ;;
            *) [[ -n "$service" ]] || service="$1"; shift ;;
        esac
    done

    case "$service" in
        ""|help|configure|sso|sso-oidc|login|logout) bypass=true ;;
    esac
    if [[ "$bypass" == false ]]; then
        awscheck --quiet "${profile_args[@]}" || return $?
    fi
    # Execute once. Never retry an AWS operation after an error.
    command aws "${original[@]}"
}

awsrun() (
    local -a profile_args
    profile_args=()
    if [[ "${1:-}" == -p || "${1:-}" == --profile ]]; then
        if (( $# < 2 )) || [[ -z "$2" || "$2" == -* ]]; then
            print -u2 'Usage: awsrun [-p PROFILE] [--] COMMAND [ARGS...]'
            return 2
        fi
        profile_args=(--profile "$2")
        # Match --profile precedence for SDK tools as well as the preflight.
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
        export AWS_PROFILE="$2"
        shift 2
    fi
    [[ "${1:-}" != -- ]] || shift
    if (( $# == 0 )); then
        print -u2 'Usage: awsrun [-p PROFILE] [--] COMMAND [ARGS...]'
        return 2
    fi
    awscheck --quiet "${profile_args[@]}" || return $?
    command "$@"
)
