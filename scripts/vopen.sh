#!/bin/bash

# Usage: vopen /path/to/dir

# Get the target directory, default to $HOME if not provided
DIR="$1"

cd "$DIR"
nvim .
