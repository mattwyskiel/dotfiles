#!/bin/bash

# AWS SSO Auto-Login Script
# Checks if AWS SSO credentials are valid and automatically logs in if needed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if AWS SSO credentials are valid
check_aws_credentials() {
    aws sts get-caller-identity >/dev/null 2>&1
    return $?
}

# Function to perform AWS SSO login
perform_sso_login() {
    echo -e "${YELLOW}AWS SSO credentials expired or invalid. Logging in...${NC}"
    
    # Check if a profile is specified
    if [ -n "$1" ]; then
        echo -e "${YELLOW}Logging in with profile: $1${NC}"
        aws sso login --profile "$1"
    else
        echo -e "${YELLOW}Logging in with default profile${NC}"
        aws sso login
    fi
    
    # Verify login was successful
    if check_aws_credentials; then
        echo -e "${GREEN}AWS SSO login successful!${NC}"
        return 0
    else
        echo -e "${RED}AWS SSO login failed!${NC}"
        return 1
    fi
}

# Main logic
main() {
    local profile=""
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -p|--profile)
                profile="$2"
                shift 2
                ;;
            -h|--help)
                echo "Usage: $0 [-p|--profile PROFILE_NAME]"
                echo "  -p, --profile    Specify AWS profile to use"
                echo "  -h, --help       Show this help message"
                exit 0
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                exit 1
                ;;
        esac
    done
    
    # Set AWS profile if specified
    if [ -n "$profile" ]; then
        export AWS_PROFILE="$profile"
        echo -e "${YELLOW}Using AWS profile: $profile${NC}"
    fi
    
    # Check current credentials
    echo "Checking AWS SSO credentials..."
    
    if check_aws_credentials; then
        echo -e "${GREEN}AWS SSO credentials are valid!${NC}"
        
        # Show current identity
        echo "Current AWS identity:"
        aws sts get-caller-identity --output table
    else
        echo -e "${YELLOW}AWS SSO credentials are expired or invalid.${NC}"
        
        # Attempt to login
        if perform_sso_login "$profile"; then
            echo "Current AWS identity:"
            aws sts get-caller-identity --output table
        else
            exit 1
        fi
    fi
}

# Run main function with all arguments
main "$@"