#!/usr/bin/env bash
file_path=$1
envsubst < "$file_path" | sqlplus -s / as sysdba