import { test, expect, type Page } from "@playwright/test";
import { loadSites } from "../src/sites";
import { registrarFalha } from "../src/findings";
import { abrirSimulador, aguardarEstabilizar, ctaClicavel, monitorarErros, tratarCookies } from "../src/page-helpers";

const LIMITE_CARREGAMENTO_MS = 10_000;

/** Avança pelas telas iniciais do simulador (ex.: escolha de marca ou de crédito) até o campo de nome. */
async function irParaEtapaNome(page: Page) {
  const nome = page.locator("input[name=name]");
  const avancoNomeado = page
    .getByRole("button", { name: /continuar|simular|próximo|avançar|escolher/i })
    .or(page.getByRole("link", { name: /continuar|simular|próximo|avançar/i }));
  const qualquerBotao = page
    .locator("button:visible:not([disabled])")
    .filter({ hasNotText: /^ver /i })
    .and(page.locator(":not([aria-label*='valor' i])"));

  for (let i = 0; i < 4 && !(await nome.isVisible().catch(() => false)); i++) {
    const avancar = (await avancoNomeado.filter({ visible: true }).count()) ? avancoNomeado.filter({ visible: true }).first() : qualquerBotao.first();
    if (!(await avancar.count())) break;
    await avancar.click({ timeout: 10_000 }).catch(() => {});
    await nome.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  }
  return nome;
}

for (const site of loadSites()) {
  test(`${site.categoria}/${site.parceiro}`, async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "url", description: site.url });
    const erros = monitorarErros(page);
    await tratarCookies(page);
    let simulador: Page = page;

    await test.step("Abrir site e verificar carregamento", async () => {
      const documentos: { status: number; url: string }[] = [];
      page.on("response", (r) => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame())
          documentos.push({ status: r.status(), url: r.url() });
      });

      const inicio = Date.now();
      await page.goto(site.url, { waitUntil: "load" });
      await page.getByText(/simular agora/i).first().waitFor({ timeout: 15_000 }).catch(() => {});
      const tempo = Date.now() - inicio;
      testInfo.annotations.push({ type: "tempo_ms", description: String(tempo) });

      await aguardarEstabilizar(page);
      testInfo.annotations.push({ type: "url_final", description: page.url() });

      const final = documentos.at(-1);
      expect(final?.status, `Página final respondeu ${final?.status} (${final?.url})`).toBeLessThan(400);

      if (documentos[0]?.status === 404)
        registrarFalha("Média", `Link responde 404 e só redireciona via JavaScript para ${page.url()} (ruim para SEO e mais lento)`);
      if (tempo > LIMITE_CARREGAMENTO_MS)
        registrarFalha("Média", `Carregamento lento: ${(tempo / 1000).toFixed(1)}s (limite ${LIMITE_CARREGAMENTO_MS / 1000}s)`);
    });

    await test.step("Verificar elementos da homepage", async () => {
      // O título pode estar na página ou dentro de um iframe
      await expect
        .poll(async () => {
          for (const frame of page.frames())
            if (await frame.locator("h1:visible").count().catch(() => 0)) return true;
          return false;
        }, { message: "Título principal (h1) ausente" })
        .toBe(true);
      const semScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      if (!semScroll) registrarFalha("Baixa", "Página tem rolagem horizontal no celular (conteúdo maior que a tela)");
    });

    await test.step('Encontrar e clicar em "Simular agora"', async () => {
      const cta = await ctaClicavel(page);
      expect(cta, 'Nenhum botão "Simular agora" visível e clicável').not.toBeNull();
      const destino = await abrirSimulador(page, cta!);
      expect(destino, `"Simular agora" não levou ao simulador (continuou em ${page.url()})`).not.toBeNull();
      simulador = destino!;
      if (simulador !== page) {
        testInfo.annotations.push({ type: "info", description: "Simulador abre em nova aba (target=_blank)" });
        const errosAba = monitorarErros(simulador);
        erros.console.push(...errosAba.console);
        erros.http.push(...errosAba.http);
        await tratarCookies(simulador);
      }
      testInfo.annotations.push({ type: "simulador_url", description: simulador.url() });
    });

    await test.step("Página da simulação abriu corretamente?", async () => {
      await simulador.waitForLoadState("load");
      await expect(simulador.locator("body")).not.toContainText(/página não encontrada|erro inesperado/i);
    });

    await test.step("Validação do formulário: nome obrigatório (sem enviar)", async () => {
      const nome = await irParaEtapaNome(simulador);
      if (!(await nome.isVisible().catch(() => false))) {
        registrarFalha("Alta", `Não foi possível chegar ao campo de nome no simulador (${simulador.url()})`);
        return;
      }
      await simulador.getByRole("button", { name: /continuar/i }).click();
      await expect(simulador.getByText(/preencha seu nome/i), "Mensagem de nome obrigatório não apareceu").toBeVisible();
      // Não avançamos daqui: o próximo passo envia o nome ao servidor e depois pede o celular com SMS.
    });

    await test.step("Estabilidade: erros de console e HTTP", async () => {
      if (erros.http.length) registrarFalha("Média", `Requisições com erro HTTP:\n${[...new Set(erros.http)].join("\n")}`);
      if (erros.console.length) registrarFalha("Baixa", `Erros de console:\n${[...new Set(erros.console)].join("\n")}`);
    });

    await testInfo.attach("evidencia-final", { body: await simulador.screenshot({ fullPage: false }), contentType: "image/png" });
  });
}
