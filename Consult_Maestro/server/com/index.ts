export { runMigrationCom01 } from './migration_com01';
export { registerCom01Routes } from './routes_com01';
export {
  criarSaleOrder, confirmarSaleOrder, solicitarFaturamento,
  marcarFaturado, cancelarSaleOrder, converterQuoteEmOrder,
  handleSaleOrderConfirmed, gerarNumeroPedido,
} from './comService';
