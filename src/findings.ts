import { test } from "@playwright/test";

export type Severity = "Crítica" | "Alta" | "Média" | "Baixa";

/**
 * Registra um problema encontrado sem interromper o teste.
 * Fica nas annotations do Playwright, que depois alimentam o banco e o relatório com IA.
 */
export function registrarFalha(severidade: Severity, descricao: string) {
  test.info().annotations.push({ type: `falha:${severidade}`, description: descricao });
}
