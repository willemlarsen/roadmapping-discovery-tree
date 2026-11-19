import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const GIT_ENV = {
  PATH: process.env.PATH,
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
};

const git = (dir, args) => execFileSync("git", args, { cwd: dir, stdio: "ignore", env: GIT_ENV });

export async function committedRepo(dir, files = {}) {
  await mkdir(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  git(dir, ["init", "--quiet"]);
  git(dir, ["add", "--all"]);
  git(dir, ["commit", "--allow-empty", "--quiet", "-m", "first"]);
}
