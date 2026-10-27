import { readFile, writeFile } from "node:fs/promises";
import { isEffectConfig } from "@gta-chaos/protocol";
import { ChaosStorage } from "./storage.js";

export type Profile = {
  schemaVersion: 2;
  exportedAt: string;
  gifts: ReturnType<ChaosStorage["listGifts"]>;
  effects: ReturnType<ChaosStorage["listEffects"]>;
};

type ImportableProfile = Omit<Partial<Profile>, "schemaVersion" | "effects"> & { schemaVersion?: number; effects?: unknown };

export async function exportProfile(storage: ChaosStorage, file: string) {
  const profile: Profile = { schemaVersion: 2, exportedAt: new Date().toISOString(), gifts: storage.listGifts(), effects: storage.listEffects() };
  await writeFile(file, JSON.stringify(profile, null, 2), "utf8");
  return profile;
}

export async function importProfile(storage: ChaosStorage, file: string) {
  const profile = JSON.parse(await readFile(file, "utf8")) as ImportableProfile;
  // Version 1 profiles remain valid; they simply have no effect definitions.
  if ((profile.schemaVersion !== 1 && profile.schemaVersion !== 2) || !Array.isArray(profile.gifts)) throw new Error("Perfil inválido o versión no soportada");
  for (const gift of profile.gifts) {
    if (!gift || typeof gift.id !== "string" || typeof gift.name !== "string" || !Array.isArray(gift.effectIds)) throw new Error("Regalo inválido en el perfil");
    storage.upsertGift(gift);
  }
  const effects = profile.effects ?? [];
  if (!Array.isArray(effects) || !effects.every(isEffectConfig)) throw new Error("Efecto inválido en el perfil");
  for (const effect of effects) storage.upsertEffect(effect);
  return { gifts: profile.gifts.length, effects: effects.length };
}

export async function main() {
  const [operation, file] = process.argv.slice(2);
  if (!operation || !file || !["export", "import", "backup"].includes(operation)) throw new Error("Uso: profile-cli export|import|backup archivo");
  const storage = new ChaosStorage();
  try {
    if (operation === "export") {
      await exportProfile(storage, file);
      console.log(`Perfil exportado: ${file}`);
      return;
    }
    if (operation === "backup") {
      storage.backup(file);
      console.log(`Backup SQLite creado: ${file}`);
      return;
    }
    const counts = await importProfile(storage, file);
    console.log(`Perfil importado: ${counts.gifts} regalos, ${counts.effects} efectos`);
  } finally { storage.close(); }
}

if (process.argv[1] && /profile-cli\.(?:ts|js|cjs)$/.test(process.argv[1])) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
