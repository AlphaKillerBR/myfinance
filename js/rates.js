/*
 * rates.js — cotação de câmbio para metas em múltiplas moedas (BRL/USD/EUR).
 *
 * Usa a API gratuita Frankfurter (dados diários do Banco Central Europeu,
 * sem necessidade de chave/API key). As cotações são cacheadas por 6 horas
 * em localStorage para funcionar bem offline e não gerar chamadas
 * desnecessárias.
 *
 * Endpoint atualizado: o domínio antigo (frankfurter.app) hoje redireciona
 * para frankfurter.dev — chamamos o novo endereço direto para evitar
 * redirecionamento entre domínios, que alguns navegadores bloqueiam.
 */

const RATES_CACHE_KEY = 'exchange_rates_cache_v1';
const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 horas

const Rates = {
  async getRatesFromBRL() {
    const cached = this._loadCache();
    const isFresh = cached && Date.now() - cached.fetchedAt < RATES_MAX_AGE_MS;
    if (isFresh) return cached;

    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?from=BRL&to=USD,EUR');
      if (!res.ok) throw new Error('Falha ao buscar cotação');
      const data = await res.json();
      const fresh = {
        date: data.date,
        rates: { BRL: 1, USD: data.rates.USD, EUR: data.rates.EUR },
        fetchedAt: Date.now(),
        stale: false,
      };
      this._saveCache(fresh);
      return fresh;
    } catch (e) {
      if (cached) return { ...cached, stale: true };
      // sem internet e sem cache nenhum ainda: assume 1:1 pra não travar a UI
      return { date: null, rates: { BRL: 1, USD: null, EUR: null }, fetchedAt: null, stale: true };
    }
  },

  _loadCache() {
    try {
      return JSON.parse(localStorage.getItem(RATES_CACHE_KEY));
    } catch (e) {
      return null;
    }
  },

  _saveCache(data) {
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(data));
  },

  // Converte um valor entre BRL/USD/EUR usando o cache de cotações fornecido
  // (retornado por getRatesFromBRL). rates.rates representa "1 BRL = X USD/EUR".
  convert(amount, fromCurrency, toCurrency, ratesData) {
    if (fromCurrency === toCurrency) return amount;
    const r = ratesData.rates;
    if (r[fromCurrency] == null || r[toCurrency] == null) return amount; // sem cotação disponível
    const amountInBRL = fromCurrency === 'BRL' ? amount : amount / r[fromCurrency];
    if (toCurrency === 'BRL') return amountInBRL;
    return amountInBRL * r[toCurrency];
  },
};

window.Rates = Rates;
