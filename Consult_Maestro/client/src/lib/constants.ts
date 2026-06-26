// Project status configuration
export const PROJECT_STATUSES = [
  { value: 'backlog', label: 'Backlog', color: 'bg-gray-500' },
  { value: 'diagnostico', label: 'Em Diagnóstico', color: 'bg-blue-500' },
  { value: 'andamento', label: 'Em Andamento', color: 'bg-yellow-500' },
  { value: 'revisao', label: 'Revisão', color: 'bg-purple-500' },
  { value: 'concluido', label: 'Concluído', color: 'bg-green-500' },
] as const;

// Canvas block types configuration with diagnostic questions
export const CANVAS_BLOCK_TYPES = [
  { 
    value: 'proposta_valor', 
    label: 'Proposta de Valor', 
    icon: 'Gift', 
    arcadiaLabel: 'Sentido / Propósito',
    questions: [
      'Que transformacao real entregamos?',
      'Estamos vendendo produto, processo, status, experiencia ou sentido?',
      'Ha diferenca entre o que achamos que vendemos e o que o cliente percebe?',
      'Ha promessa implicita (como confiabilidade, seguranca, status, espiritualidade)?'
    ],
    outputs: ['Mapa de Identidade', 'Diagnostico de posicionamento', 'Insight de comunicacao']
  },
  { 
    value: 'segmentos', 
    label: 'Segmentos de Clientes', 
    icon: 'Users', 
    arcadiaLabel: 'Quem recebe nossa transformação',
    questions: [
      'Quem compra X quem usa X quem influencia?',
      'Qual tipo de cliente e mais lucrativo?',
      'Quais clientes sugam energia?',
      'Qual cliente queremos ter no futuro?'
    ],
    outputs: ['Matriz de Cliente Ideal', 'Perfil comportamental', 'Matriz de Selecao do Cliente']
  },
  { 
    value: 'canais', 
    label: 'Canais', 
    icon: 'Route', 
    arcadiaLabel: 'Caminhos / Pontes',
    questions: [
      'Como o cliente chega?',
      'Os canais tem processo, funil, CRM, indicadores?',
      'Quais canais sao intuitivos vs profissionais?'
    ],
    outputs: ['Quadro de maturidade comercial', 'Diagnostico de funil', 'Desenho inicial para CRM e automacao']
  },
  { 
    value: 'relacionamento', 
    label: 'Relacionamento', 
    icon: 'Heart', 
    arcadiaLabel: 'Forma de Amar/Servir',
    questions: [
      'Qual e o estilo da relacao? (reativo, assistencial, premium, instrucional, etc.)',
      'Documentamos interacoes?',
      'Existe NPS/feedback/BI?'
    ],
    outputs: ['Modelo de relacionamento', 'Maturidade do CRM', 'Necessidade de pos-venda estruturado']
  },
  { 
    value: 'receita', 
    label: 'Fontes de Receita', 
    icon: 'DollarSign', 
    arcadiaLabel: 'Energia que sustenta o propósito',
    questions: [
      'Quais receitas nos sustentam?',
      'Ha dependencia de uma so fonte?',
      'Ha receita recorrente?',
      'Ha receita ignorada (consultoria, manutencao, royalty)?'
    ],
    outputs: ['Arvore de Receitas', 'Oportunidades financeiras ocultas', 'Avaliacao do modelo de precificacao']
  },
  { 
    value: 'recursos', 
    label: 'Recursos-Chave', 
    icon: 'Box', 
    arcadiaLabel: 'Capacidades / Disposições',
    questions: [
      'Quais pessoas sao essenciais?',
      'Qual tecnologia e essencial (ERP, CRM, BI, n8n, tokenizacao)?',
      'Quais processos sao essenciais?',
      'Ha conhecimento proprietario (metodologia, patentes, formulas, marca)?'
    ],
    outputs: ['Inventario de capacidades', 'Grau de dependencia', 'Insight sobre risco de sucessao']
  },
  { 
    value: 'atividades', 
    label: 'Atividades-Chave', 
    icon: 'Cog', 
    arcadiaLabel: 'Ações / Ritmos',
    questions: [
      'O que precisa acontecer diariamente?',
      'Isso e documentado?',
      'E feito com disciplina?',
      'Existem indicadores associados?'
    ],
    outputs: ['Lista de processos criticos', 'Priorizacao de automacao para ERP/CRM/BI', 'Pontos de gargalo']
  },
  { 
    value: 'parcerias', 
    label: 'Parcerias-Chave', 
    icon: 'Handshake', 
    arcadiaLabel: 'Alianças e interdependência',
    questions: [
      'Quem nos viabiliza?',
      'Somos dependentes demais?',
      'Que parcerias estrategicas precisariam existir?'
    ],
    outputs: ['Analise de cadeia de suprimento', 'Mapa de poder/influencia', 'Estrategias de governanca/futuras aliancas']
  },
  { 
    value: 'custos', 
    label: 'Estrutura de Custos', 
    icon: 'Calculator', 
    arcadiaLabel: 'Sacrifícios / Investimentos',
    questions: [
      'Quais custos nao agregam valor?',
      'Ha margens ocultas por produto/cliente?',
      'Falta forecast?',
      'Estrutura esta inflada?'
    ],
    outputs: ['Radiografia financeira inicial', 'O METAS como ferramenta de governanca', 'Necessidades de BI financeiro']
  },
] as const;

// Canvas levels (value maps to database enum, label is display text)
export const CANVAS_LEVELS = [
  { value: 'intencao', label: 'Atual', description: 'Estado atual do negócio - como está hoje' },
  { value: 'sistemico', label: 'Sistêmico', description: 'Visão sistêmica - como os blocos se conectam e evoluem' },
] as const;

// Task statuses
export const TASK_STATUSES = [
  { value: 'todo', label: 'A Fazer' },
  { value: 'in_progress', label: 'Em Progresso' },
  { value: 'review', label: 'Revisão' },
  { value: 'done', label: 'Concluído' },
] as const;

// Deliverable types
export const DELIVERABLE_TYPES = [
  { value: 'canvas_real', label: 'Canvas Real', description: 'Versão cliente vs versão consultor' },
  { value: 'canvas_sistemico', label: 'Canvas Sistêmico', description: 'Interfaces ERP, CRM, BI, Tokenização' },
  { value: 'lacunas', label: 'Lacunas Visíveis', description: 'Backlog de Diagnóstico' },
  { value: 'roadmap', label: 'Canvas de Transformação', description: 'Prioridades e roadmap' },
] as const;

// Process categories
export const PROCESS_CATEGORIES = [
  { value: 'comercial', label: 'Comercial' },
  { value: 'operacional', label: 'Operacional' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'tecnologia', label: 'Tecnologia' },
  { value: 'rh', label: 'Recursos Humanos' },
] as const;

// ERP Modules
export const ERP_MODULES = [
  { value: 'financeiro', label: 'Financeiro', description: 'Contas a pagar/receber, fluxo de caixa' },
  { value: 'contabil', label: 'Contabil', description: 'Contabilidade e balancetes' },
  { value: 'faturamento', label: 'Faturamento', description: 'Emissao de notas fiscais' },
  { value: 'compras', label: 'Compras', description: 'Gestao de fornecedores e pedidos' },
  { value: 'estoque', label: 'Estoque', description: 'Controle de inventario' },
  { value: 'producao', label: 'Producao', description: 'PCP e ordens de producao' },
  { value: 'rh', label: 'Recursos Humanos', description: 'Folha de pagamento e gestao de pessoal' },
  { value: 'crm', label: 'CRM', description: 'Gestao de relacionamento com cliente' },
  { value: 'vendas', label: 'Vendas', description: 'Pedidos e comissionamento' },
  { value: 'logistica', label: 'Logistica', description: 'Expedicao e transporte' },
  { value: 'projetos', label: 'Projetos', description: 'Gestao de projetos e cronogramas' },
] as const;

// ERP Adherence Status
export const ERP_ADHERENCE_STATUS = [
  { value: 'nativo', label: 'Nativo', color: 'bg-green-500', description: 'Atendido pelo ERP padrao' },
  { value: 'configuravel', label: 'Configuravel', color: 'bg-blue-500', description: 'Requer ajuste de parametros' },
  { value: 'customizavel', label: 'Customizavel', color: 'bg-yellow-500', description: 'Requer desenvolvimento' },
  { value: 'nao_atendido', label: 'Nao Atendido', color: 'bg-red-500', description: 'Nao suportado pelo ERP' },
] as const;

// ERP Priority
export const ERP_PRIORITY = [
  { value: 'alta', label: 'Alta', color: 'text-red-500' },
  { value: 'media', label: 'Media', color: 'text-yellow-500' },
  { value: 'baixa', label: 'Baixa', color: 'text-muted-foreground' },
] as const;
