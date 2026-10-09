import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_DIR,
  DB_SCHEMA,
  one,
  exec,
  tx,
  setSetting,
  closeDb,
} from "../src/db.js";
import { upgrade } from "../src/seed.js";
import { hashPassword } from "../src/auth.js";
if (DB_SCHEMA !== "public")
  throw new Error("Owner initialization requires public");
const username = process.argv[2];
if (!username || !/^[a-z][a-z0-9._-]{2,49}$/i.test(username))
  throw new Error("Provide the authorized owner username");
const existing = await one("SELECT id FROM users WHERE username = ?", [
  username,
]);
if (!existing) {
  if (await one("SELECT 1 FROM users LIMIT 1"))
    throw new Error("An administrator already exists; use the setup flow");
  await upgrade();
  const password = `M-${randomBytes(15).toString("base64url")}!9`;
  const email = `${username}@mandob.local`;
  const hash = await hashPassword(password);
  await tx(async () => {
    const role = await one<{ id: number }>(
      "SELECT id FROM roles WHERE name='Super Admin'",
    );
    if (!role) throw new Error("Super Admin role is missing");
    await exec(
      "INSERT INTO users(username,full_name,email,password_hash,role_id) VALUES (?,?,?,?,?)",
      [username, username, email, hash, role.id],
    );
    await setSetting("system.installed", "1");
  });
  writeFileSync(
    join(DATA_DIR, "first-login.txt"),
    `Mandoob local application\nURL: http://localhost:4000/admin/login\nUsername: ${username}\nEmail: ${email}\nPassword: ${password}\n\nThis email is a local placeholder. Update it in your profile.\n`,
  );
  console.log(
    "Owner created; credentials saved in server/data/first-login.txt",
  );
} else console.log("Existing owner preserved");
await closeDb();
