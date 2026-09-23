/**
 * Gera o relatório em texto (Markdown) a partir de resultados/results.json.
 * Uso: npm run relatorio
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORDEM = ["Crítica", "Alta", "Média", "Baixa"] as const;
type Sev = (typeof ORDEM)[number];
const ICONE: Record<Sev, string> = { Crítica: "🔴", Alta: "🟠", Média: "🟡", Baixa: "🟢" };

type Annotation = { type: string; description?: string };
type Resultado = {
  site: string;
  dispositivo: string;
  status: string;
  url: string;
  urlFinal?: string;
  tempoMs?: number;
  falhas: { sev: Sev; texto: string }[];
  erro?: string;
  etapa?: string;
  print?: string;
};

const semAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-");

const json = JSON.parse(readFileSync("resultados/results.json", "utf8"));
const outDir = "reports";
const imgDir = join(outDir, "evidencias");
mkdirSync(imgDir, { recursive: true });

const resultados: Resultado[] = [];

function visitar(suite: any) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const r = t.results.at(-1);
      if (!r) continue;
      const ann: Annotation[] = [...(t.annotations ?? []), ...(r.annotations ?? [])];
      const get = (k: string) => ann.find((a) => a.type === k)?.description;
      const falhas = ann
        .filter((a) => a.type.startsWith("falha:"))
        .map((a) => ({ sev: a.type.slice(6) as Sev, texto: a.description ?? "" }));
      const status = r.status === "passed" && t.status === "flaky" ? "instável" : r.status;

      const res: Resultado = {
        site: spec.title,
        dispositivo: t.projectName,
        status,
        url: get("url") ?? "",
        urlFinal: get("url_final"),
        tempoMs: get("tempo_ms") ? Number(get("tempo_ms")) : undefined,
        falhas,
      };

      if (r.status !== "passed") {
        const e = r.errors?.[0] ?? r.error;
        res.erro = semAnsi(e?.message ?? "erro desconhecido").split("\n").filter(Boolean).slice(0, 3).join(" ");
        res.etapa = r.steps?.find((s: any) => s.error)?.title;
      }

      // Print: só guardamos quando há erro ou falha registrada
      if (res.erro || falhas.length) {
        const att = r.attachments?.find((a: any) => a.name === "screenshot" && a.path) ??
          r.attachments?.find((a: any) => a.name === "evidencia-final");
        const destino = join(imgDir, `${slug(spec.title)}-${t.projectName}.png`);
        if (att?.path && existsSync(att.path)) copyFileSync(att.path, destino);
        else if (att?.body) writeFileSync(destino, Buffer.from(att.body, "base64"));
        if (existsSync(destino)) res.print = `evidencias/${slug(spec.title)}-${t.projectName}.png`;
      }
      resultados.push(res);
    }
  }
  for (const s of suite.suites ?? []) visitar(s);
}
json.suites.forEach(visitar);

// ---------- Montagem do texto ----------
const agora = new Date();
const data = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const sites = [...new Set(resultados.map((r) => r.site))].sort();
const reprovados = resultados.filter((r) => r.status !== "passed" && r.status !== "instável");
const comAlerta = resultados.filter((r) => r.falhas.length && !reprovados.includes(r));
const contagem = Object.fromEntries(ORDEM.map((s) => [s, 0])) as Record<Sev, number>;
for (const r of resultados) {
  if (r.erro) contagem["Crítica"]++;
  for (const f of r.falhas) contagem[f.sev]++;
}

const linhas: string[] = [];
const L = (s = "") => linhas.push(s);

L(`# Relatório de QA – Sites de Consórcio`);
L();
L(`**Data:** ${data}  `);
L(`**Sites testados:** ${sites.length}  `);
L(`**Dispositivos:** ${[...new Set(resultados.map((r) => r.dispositivo))].join(", ")}  `);
L(`**Execuções:** ${resultados.length} (${resultados.length - reprovados.length} aprovadas, ${reprovados.length} reprovadas, ${comAlerta.length} aprovadas com alerta)`);
L();
L(`| Severidade | Ocorrências |`);
L(`|---|---|`);
for (const s of ORDEM) L(`| ${ICONE[s]} ${s} | ${contagem[s]} |`);
L();

L(`## Resumo por site`);
L();
L(`| Site | Android | iPhone | Tempo (Android / iPhone) |`);
L(`|---|---|---|---|`);
const selo = (r?: Resultado) =>
  !r ? "–" : r.erro ? "❌ Reprovado" : r.falhas.length ? `⚠️ ${r.falhas.length} alerta(s)` : "✅ OK";
const seg = (r?: Resultado) => (r?.tempoMs ? `${(r.tempoMs / 1000).toFixed(1)}s` : "–");
for (const s of sites) {
  const a = resultados.find((r) => r.site === s && r.dispositivo === "android");
  const i = resultados.find((r) => r.site === s && r.dispositivo === "iphone");
  L(`| [${s}](${(a ?? i)?.url}) | ${selo(a)} | ${selo(i)} | ${seg(a)} / ${seg(i)} |`);
}
L();

const problemas = resultados.filter((r) => r.erro || r.falhas.length);
L(`## Problemas encontrados`);
L();
if (!problemas.length) L(`Nenhum problema encontrado. 🎉`);

for (const s of sites) {
  const doSite = problemas.filter((r) => r.site === s);
  if (!doSite.length) continue;
  L(`### ${s}`);
  L();
  L(`🔗 **Link:** ${doSite[0].url}  `);
  if (doSite[0].urlFinal && doSite[0].urlFinal !== doSite[0].url) L(`↪️ **Redireciona para:** ${doSite[0].urlFinal}  `);
  L();
  for (const r of doSite) {
    L(`**${r.dispositivo === "iphone" ? "iPhone" : "Android"}**`);
    L();
    if (r.erro) L(`- ${ICONE["Crítica"]} **Crítica – teste reprovado** na etapa _${r.etapa ?? "?"}_: ${r.erro}`);
    for (const f of [...r.falhas].sort((x, y) => ORDEM.indexOf(x.sev) - ORDEM.indexOf(y.sev))) {
      const [primeira, ...resto] = f.texto.split("\n");
      L(`- ${ICONE[f.sev]} **${f.sev}:** ${primeira}`);
      for (const extra of resto) L(`  - \`${extra}\``);
    }
    if (r.print) {
      L();
      L(`![Print ${r.site} (${r.dispositivo})](${r.print})`);
      L();
      L(`[Abrir print em tamanho real](${r.print})`);
    }
    L();
  }
}

const nome = `relatorio-${agora.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
writeFileSync(join(outDir, nome), linhas.join("\n"), "utf8");
writeFileSync(join(outDir, "ultimo-relatorio.md"), linhas.join("\n"), "utf8");
console.log(`Relatório gerado: ${join(outDir, nome)} (${problemas.length} execuções com problemas)`);
