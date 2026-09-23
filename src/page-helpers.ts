import type { Locator, Page } from "@playwright/test";
import { DOMINIOS_PROPRIOS, SIMULADOR_HOST } from "./config";

/** Fecha o banner de cookies sempre que ele aparecer (inclusive se surgir com atraso). */
export async function tratarCookies(page: Page) {
  await page.addLocatorHandler(page.getByRole("button", { name: /rejeitar tudo/i }), async (botao) => {
    await botao.click();
  });
}

/**
 * Páginas Framer navegam de novo para a própria URL logo após carregar.
 * Espera até passar `quietoMs` sem nenhuma navegação no frame principal (limite `maxMs`).
 */
export async function aguardarEstabilizar(page: Page, quietoMs = 2_000, maxMs = 15_000) {
  let ultima = Date.now();
  const marcar = (f: unknown) => f === page.mainFrame() && (ultima = Date.now());
  page.on("framenavigated", marcar);
  const inicio = Date.now();
  while (Date.now() - ultima < quietoMs && Date.now() - inicio < maxMs) await page.waitForTimeout(250);
  page.off("framenavigated", marcar);
  await page.waitForLoadState("load");
}

/**
 * As páginas têm cópias ocultas do CTA para outros breakpoints, e algumas o colocam dentro de iframe.
 * Retorna o primeiro "Simular agora" (link ou botão, em qualquer frame) que o Playwright consegue de fato clicar.
 */
export async function ctaClicavel(page: Page): Promise<Locator | null> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    for (const frame of page.frames()) {
      const ctas = frame.getByRole("link", { name: /simular agora/i }).or(frame.getByRole("button", { name: /simular agora/i }));
      const total = await ctas.count().catch(() => 0);
      for (let i = 0; i < total; i++) {
        const cta = ctas.nth(i);
        try {
          await cta.click({ trial: true, timeout: 3_000 });
          return cta;
        } catch {
          // coberto, oculto ou redesenhado: tenta o próximo
        }
      }
    }
    await page.waitForTimeout(1_000);
  }
  return null;
}

const ehSimulador = (url: string | URL) => new URL(url).host === SIMULADOR_HOST;

/**
 * Clica no CTA e devolve a página do simulador, seja na mesma aba ou em uma nova (target=_blank).
 * Tenta duas vezes, pois um clique durante uma re-renderização pode ser perdido.
 */
export async function abrirSimulador(page: Page, cta: Locator): Promise<Page | null> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const novaAba = page.context().waitForEvent("page", { timeout: 12_000 }).catch(() => null);
    const mesmaAba = page.waitForURL(ehSimulador, { timeout: 12_000 }).then(() => page).catch(() => null);
    await cta.click({ timeout: 10_000 }).catch(() => {});
    const destino = await Promise.race([
      mesmaAba,
      novaAba.then(async (p) => {
        if (!p) return null;
        await p.waitForURL(ehSimulador, { timeout: 12_000 }).catch(() => {});
        return ehSimulador(p.url()) ? p : null;
      }),
    ]);
    if (destino) return destino;
    const outra = page.context().pages().find((p) => ehSimulador(p.url()));
    if (outra) return outra;
  }
  return null;
}

/** Coleta erros de console e respostas HTTP 4xx/5xx da página. */
export function monitorarErros(page: Page) {
  const console: string[] = [];
  const http: string[] = [];
  page.on("console", (m) => m.type() === "error" && console.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => console.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    // Ignora pixels de analytics/ads, que não são responsabilidade do site
    if (r.status() >= 400 && DOMINIOS_PROPRIOS.some((d) => r.url().includes(d)))
      http.push(`${r.status()} ${r.url().slice(0, 150)}`);
  });
  return { console, http };
}
