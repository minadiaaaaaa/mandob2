#!/bin/sh
# Starts Mandoob in the Hugging Face Space.
# - With a DATABASE_URL secret (for example Aiven's Service URI, plus DB_SSL_CA) it uses that database.
# - Without one it runs MariaDB inside the container. That database lives in /tmp, so it starts empty after every
#   restart or rebuild of the Space: staging only.
set -e

if [ -z "$DATABASE_URL" ]; then
  DB=/tmp/mariadb
  mkdir -p "$DB/data" "$DB/run"
  if [ ! -d "$DB/data/mysql" ]; then
    echo "local database: creating it"
    mariadb-install-db --no-defaults --datadir="$DB/data" --auth-root-authentication-method=normal --skip-test-db > "$DB/install.log" 2>&1 \
      || { cat "$DB/install.log"; exit 1; }
  fi
  mariadbd --no-defaults --datadir="$DB/data" --socket="$DB/run/mysqld.sock" --pid-file="$DB/run/mysqld.pid" \
    --port=3306 --bind-address=127.0.0.1 --skip-name-resolve \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci > "$DB/mariadbd.log" 2>&1 &
  i=0
  until mariadb-admin --no-defaults --socket="$DB/run/mysqld.sock" -uroot ping > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then echo "local database did not start:"; cat "$DB/mariadbd.log"; exit 1; fi
    sleep 1
  done
  # A new password at every start; only this process knows it, and the database listens on 127.0.0.1 only.
  PASS=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  mariadb --no-defaults --socket="$DB/run/mysqld.sock" -uroot -e "
    CREATE DATABASE IF NOT EXISTS mandoob CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'mandoob'@'127.0.0.1' IDENTIFIED BY '$PASS';
    ALTER USER 'mandoob'@'127.0.0.1' IDENTIFIED BY '$PASS';
    GRANT ALL PRIVILEGES ON *.* TO 'mandoob'@'127.0.0.1';"
  export DATABASE_URL="mysql://mandoob:$PASS@127.0.0.1:3306/mandoob"
  echo "local database: ready (its data is lost when the Space restarts)"
fi

cd /app/server
exec node --import tsx src/index.ts
