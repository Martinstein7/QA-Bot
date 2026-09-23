import "dotenv/config";

function obrigatoria(nome: string): string {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`Variável ${nome} não definida. Copie .env.example para .env e preencha.`);
  return valor;
}

/** Host do simulador para onde o "Simular agora" deve levar (ex.: simulador.exemplo.com.br). */
export const SIMULADOR_HOST = obrigatoria("SIMULADOR_HOST");

/** Domínios cujos erros HTTP entram no relatório (os demais, como pixels de anúncio, são ignorados). */
export const DOMINIOS_PROPRIOS = obrigatoria("DOMINIOS_PROPRIOS")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);
