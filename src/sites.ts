import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export type Site = {
  produto: string;
  categoria: string;
  parceiro: string;
  url: string;
  ativo: string;
};

export function loadSites(path = "data/sites.csv"): Site[] {
  const rows: Site[] = parse(readFileSync(path), { columns: true, skip_empty_lines: true, trim: true });
  return rows.filter((s) => s.ativo.toLowerCase() === "sim");
}
