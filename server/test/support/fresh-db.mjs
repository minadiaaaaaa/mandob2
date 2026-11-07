// Drops and recreates a disposable test database. Refuses any name that does not start with mandoob_test.
import mysql from "mysql2/promise";

const url = new URL(process.argv[2] ?? "");
const name = decodeURIComponent(url.pathname.slice(1));
if (!/^mandoob_test[a-z0-9_]*$/.test(name)) throw new Error("Disposable test databases only (mandoob_test…)");
const conn = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await conn.end();
console.log("fresh database:", name);
