#!/bin/sh
set -e
export PORT="${PORT:-8080}"
envsubst '$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
