**ARCÁDIA CONSULT — Super Agente Redesign**

*Interface tipo Claude/Manus — Prompt para Replit Agent*

Baseado na análise do código real: SuperAgent.tsx \+ SuperAgentChat.tsx (1308 linhas)

# **CONTEXTO — O QUE EXISTE HOJE**

A página /super-agente (SuperAgent.tsx, 30 linhas) é apenas um wrapper que renderiza SuperAgentChat. O componente SuperAgentChat.tsx (1308 linhas) já tem toda a lógica funcional: sessões, streaming SSE, upload de arquivos (SessionFiles), sidebar colapsável (SessionsSidebar), task pane de passos ao vivo (TaskPane), seletor de agente (ChatHeader) e parser de scrum-plan.

O que ESTÁ PRONTO e deve ser preservado: toda a lógica de dados (useQuery, useMutation), o streaming SSE (runStream), o parser de scrum-plan (ScrumPlanCard), o upload de arquivos (SessionFiles), a lógica de pré-seleção de agente por slug, os data-testid de todos os elementos existentes.

O que PRECISA MUDAR: apenas o layout visual e a experiência da interface. O objetivo é tornar o Super Agente a tela principal da plataforma — uma interface fluida, limpa e poderosa como o Claude.ai ou o Manus, não mais uma 'seção dentro de uma página'.

# **OBJETIVO**

Redesenhar o layout da página /super-agente para ocupar 100% do viewport disponível (sem padding da página, sem header duplo), com 3 colunas fixas: sidebar esquerda, área de chat central e painel direito de contexto. Melhorar o input com atalhos de contexto. Manter 100% da lógica existente sem regressão.

# **PARTE 1 — SuperAgent.tsx: ocupar 100% do viewport**

O arquivo client/src/pages/SuperAgent.tsx hoje tem padding p-6 e um header com título. Substituir completamente por:

import { useMemo } from 'react'

import { useSearch } from 'wouter'

import { SuperAgentChat } from '@/components/SuperAgentChat'

export default function SuperAgent() {

  const search \= useSearch()

  const { agentSlug, widgetContext } \= useMemo(() \=\> {

    const p \= new URLSearchParams(search)

    return {

      agentSlug: p.get('agent') ?? undefined,

      widgetContext: p.get('widget') ?? undefined,

    }

  }, \[search\])

  return (

    \<div className='h-full flex flex-col overflow-hidden'\>

      \<SuperAgentChat

        heightClass='flex-1 min-h-0'

        preselectAgentSlug={agentSlug}

        widgetContext={widgetContext}

      /\>

    \</div\>

  )

}

# **PARTE 2 — SuperAgentChat.tsx: layout principal tipo Claude**

## **2.1 — Novo layout do modo FULL (substituir o return do modo full)**

Localizar no SuperAgentChat o bloco '// FULL (página /super-agente)' e substituir o JSX retornado por:

// FULL — layout 3 colunas ocupa todo o espaço disponível

return (

  \<div className='flex h-full min-h-0 overflow-hidden'\>

    {/\* COLUNA ESQUERDA — sidebar de sessões \*/}

    \<SessionsSidebar

      collapsed={sidebarCollapsed}

      onToggleCollapse={() \=\> setSidebarCollapsed(v \=\> \!v)}

      sessions={sessions}

      sessionsLoading={sessionsLoading}

      projects={projects}

      clients={clientsList}

      activeSessionId={activeSessionId}

      setActiveSessionId={setActiveSessionId}

      deleteSession={deleteSession}

      createSession={createSession}

      search={search}

      setSearch={setSearch}

    /\>

    {/\* COLUNA CENTRAL — área de chat \*/}

    \<div className='flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden'\>

      {/\* Header fixo quando há sessão ativa \*/}

      {activeSession && (

        \<ChatHeader

          session={activeSession}

          agents={activeAgents}

          onChangeAgent={agentId \=\> patchSession.mutate({ id: activeSession.id, body: { agentId } })}

        /\>

      )}

      {/\* Chat ocupa o espaço restante \*/}

      \<ChatPanel

        heightClass='flex-1 min-h-0'

        activeSessionId={activeSessionId}

        messagesData={messagesData}

        messagesLoading={messagesLoading}

        scrollRef={scrollRef}

        isPending={streaming}

        input={input}

        setInput={setInput}

        handleSend={handleSend}

        projectId={projectId}

        streamSteps={streamSteps}

        agents={activeAgents}

        projects={projects}

        onCreateSession={() \=\> createSession.mutate()}

      /\>

    \</div\>

    {/\* COLUNA DIREITA — task pane \*/}

    \<TaskPane

      expanded={taskPaneExpanded}

      onToggleExpand={() \=\> setTaskPaneExpanded(v \=\> \!v)}

      steps={streamSteps}

      streaming={streaming}

      fallbackMessages={messagesData?.messages ?? \[\]}

    /\>

  \</div\>

)

## **2.2 — Redesign da SessionsSidebar**

Manter toda a lógica existente (grupos, busca, delete). Alterar apenas o visual e dimensões:

// Sidebar expandida: largura 260px (era 288px), sem border-radius (ocupa full height)

// Fundo: bg-muted/30 (sutil, diferente do chat)

// Remover: className='border rounded-md' — usar apenas 'border-r'

// Slim mode: manter comportamento atual, apenas ajustar classe:

// era: 'w-12 flex-shrink-0 border rounded-md'

// vira: 'w-12 flex-shrink-0 border-r bg-muted/30'

// Expanded mode:

// era: 'w-72 flex-shrink-0 border rounded-md flex flex-col bg-card'

// vira: 'w-64 flex-shrink-0 border-r flex flex-col bg-muted/30'

// Botão 'Nova conversa' — virar mais prominente:

// Adicionar ícone Sparkles ao lado de Plus:

// \<Button size='sm' className='flex-1 gap-1.5' ...\>

//   \<Sparkles className='h-3.5 w-3.5' /\>

//   Nova conversa

// \</Button\>

// Sessão ativa — highlight mais visível:

// era: 'bg-accent'

// vira: 'bg-background border-l-2 border-primary'

## **2.3 — Redesign do ChatHeader**

O ChatHeader atual é uma barra de seletor de agente simples. Melhorar para mostrar nome da sessão editável e agente selecionado com ícone:

// Manter lógica de onChangeAgent. Melhorar visual:

// era: 'flex items-center gap-2 border rounded-md px-3 py-2 bg-card flex-shrink-0'

// vira: 'flex items-center gap-3 border-b px-4 py-2.5 bg-background flex-shrink-0'

// Adicionar: título da sessão maior e agente com badge colorido

// Estrutura nova do ChatHeader JSX:

\<div className='flex items-center gap-3 border-b px-4 py-2.5 bg-background flex-shrink-0' data-testid='chat-header'\>

  {/\* Ícone do agente \*/}

  \<div className='h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0'\>

    {current ? \<Bot className='h-4 w-4 text-primary' /\> : \<Sparkles className='h-4 w-4 text-primary' /\>}

  \</div\>

  {/\* Nome da sessão \*/}

  \<div className='flex-1 min-w-0'\>

    \<div className='text-sm font-medium truncate'\>{session.title}\</div\>

    {current && \<div className='text-\[11px\] text-muted-foreground truncate'\>{current.name}\</div\>}

  \</div\>

  {/\* Seletor de agente — mais compacto \*/}

  \<Select value={value} onValueChange={v \=\> onChangeAgent(v \=== '\_\_general\_\_' ? null : v)}\>

    \<SelectTrigger className='h-7 text-xs w-\[180px\] border-dashed' data-testid='select-agent'\>

      \<SelectValue placeholder='Agente' /\>

    \</SelectTrigger\>

    \<SelectContent\>

      \<SelectItem value='\_\_general\_\_'\>

        \<span className='flex items-center gap-1.5'\>\<Sparkles className='h-3 w-3' /\> Super Agente Geral\</span\>

      \</SelectItem\>

      {agents.map(a \=\> (

        \<SelectItem key={a.id} value={a.id} data-testid={\`option-agent-${a.id}\`}\>

          \<span className='flex items-center gap-1.5'\>\<Bot className='h-3 w-3' /\> {a.name}\</span\>

        \</SelectItem\>

      ))}

    \</SelectContent\>

  \</Select\>

\</div\>

## **2.4 — Redesign do ChatPanel: tela de boas-vindas \+ input melhorado**

A maior mudança visual. Quando não há sessão ativa, mostrar tela de boas-vindas tipo Claude. Quando há sessão, melhorar o input com atalhos de contexto.

Adicionar 2 novos props ao ChatPanel: agents e projects (para os atalhos), onCreateSession (para o botão da tela inicial):

// Adicionar ao ChatPanelProps:

agents?: AgentDefinitionLite\[\]

projects?: ProjectLite\[\]

onCreateSession?: () \=\> void

Substituir o bloco de 'não há sessão ativa' pela tela de boas-vindas:

// era: texto simples 'Comece uma conversa'

// vira: tela de boas-vindas centralizada tipo Claude/Manus

\!activeSessionId ? (

  \<div className='flex-1 flex flex-col items-center justify-center gap-8 px-6 py-12'\>

    {/\* Logo / título \*/}

    \<div className='text-center space-y-2'\>

      \<div className='h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto'\>

        \<Sparkles className='h-7 w-7 text-primary' /\>

      \</div\>

      \<h2 className='text-2xl font-semibold'\>O que posso fazer por você?\</h2\>

      \<p className='text-sm text-muted-foreground max-w-sm'\>

        Consulte projetos, analise dados, execute tarefas em sistemas externos e muito mais.

      \</p\>

    \</div\>

    {/\* Input centralizado na tela de boas-vindas \*/}

    \<div className='w-full max-w-2xl'\>

      \<WelcomeInput

        input={input}

        setInput={setInput}

        handleSend={handleSend}

        isPending={streaming}

        onCreateSession={onCreateSession}

        agents={agents ?? \[\]}

        projects={projects ?? \[\]}

      /\>

    \</div\>

    {/\* Sugestões de ações rápidas \*/}

    \<div className='flex flex-wrap gap-2 justify-center max-w-lg'\>

      {\[

        'Quais projetos estão com prazo vencido?',

        'Analise o pipeline de clientes',

        'Quais NF-e estão pendentes?',

        'Gere um relatório do mês',

      \].map(suggestion \=\> (

        \<button

          key={suggestion}

          onClick={() \=\> { setInput(suggestion); onCreateSession?.() }}

          className='text-xs px-3 py-1.5 rounded-full border border-dashed hover:border-primary hover:text-primary transition-colors text-muted-foreground'

        \>

          {suggestion}

        \</button\>

      ))}

    \</div\>

  \</div\>

) : /\* restante do ChatPanel existente... \*/

## **2.5 — Novo componente WelcomeInput (dentro do SuperAgentChat.tsx)**

Criar um novo componente interno WelcomeInput com input grande, botão de anexo e atalhos de contexto (projetos e agentes):

function WelcomeInput({ input, setInput, handleSend, isPending, onCreateSession, agents, projects }: {

  input: string

  setInput: (v: string) \=\> void

  handleSend: () \=\> void

  isPending: boolean

  onCreateSession?: () \=\> void

  agents: AgentDefinitionLite\[\]

  projects: ProjectLite\[\]

}) {

  const fileInputRef \= useRef\<HTMLInputElement\>(null)

  const \[showAgents, setShowAgents\] \= useState(false)

  const \[showProjects, setShowProjects\] \= useState(false)

  function handleSendAndCreate() {

    if (\!input.trim()) return

    onCreateSession?.()

    handleSend()

  }

  return (

    \<div className='border rounded-2xl bg-background shadow-sm overflow-hidden'\>

      {/\* Textarea grande \*/}

      \<Textarea

        value={input}

        onChange={e \=\> setInput(e.target.value)}

        onKeyDown={e \=\> {

          if (e.key \=== 'Enter' && \!e.shiftKey) { e.preventDefault(); handleSendAndCreate() }

        }}

        placeholder='Atribua uma tarefa ou pergunte qualquer coisa...'

        className='min-h-\[80px\] max-h-48 resize-none border-0 rounded-none focus-visible:ring-0 text-sm px-4 pt-4'

        disabled={isPending}

        data-testid='textarea-super-agent-input'

      /\>

      {/\* Barra inferior com atalhos e botão enviar \*/}

      \<div className='flex items-center gap-2 px-3 py-2 border-t bg-muted/30'\>

        {/\* Botão anexar \*/}

        \<Button size='icon' variant='ghost' className='h-8 w-8 text-muted-foreground'

          onClick={() \=\> fileInputRef.current?.click()} title='Anexar arquivo'\>

          \<Paperclip className='h-4 w-4' /\>

        \</Button\>

        \<input ref={fileInputRef} type='file' multiple className='hidden'

          accept='.pdf,.docx,.xlsx,.csv,.txt,.md' /\>

        {/\* Atalho: Agentes \*/}

        \<div className='relative'\>

          \<Button size='sm' variant='ghost' className='h-8 gap-1.5 text-xs text-muted-foreground'

            onClick={() \=\> { setShowAgents(v \=\> \!v); setShowProjects(false) }}\>

            \<Bot className='h-3.5 w-3.5' /\>

            Agente

          \</Button\>

          {showAgents && agents.length \> 0 && (

            \<div className='absolute bottom-10 left-0 z-50 w-56 bg-background border rounded-lg shadow-lg p-1'\>

              \<div className='text-\[10px\] text-muted-foreground px-2 py-1 font-medium uppercase tracking-wide'\>Selecionar agente\</div\>

              {agents.slice(0, 8).map(a \=\> (

                \<button key={a.id}

                  className='w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent flex items-center gap-2'

                  onClick={() \=\> { setInput(prev \=\> prev); setShowAgents(false) }}\>

                  \<Bot className='h-3 w-3 text-muted-foreground' /\> {a.name}

                \</button\>

              ))}

            \</div\>

          )}

        \</div\>

        {/\* Atalho: Projetos \*/}

        \<div className='relative'\>

          \<Button size='sm' variant='ghost' className='h-8 gap-1.5 text-xs text-muted-foreground'

            onClick={() \=\> { setShowProjects(v \=\> \!v); setShowAgents(false) }}\>

            \<FolderOpen className='h-3.5 w-3.5' /\>

            Projeto

          \</Button\>

          {showProjects && projects.length \> 0 && (

            \<div className='absolute bottom-10 left-0 z-50 w-64 bg-background border rounded-lg shadow-lg p-1'\>

              \<div className='text-\[10px\] text-muted-foreground px-2 py-1 font-medium uppercase tracking-wide'\>Adicionar contexto\</div\>

              {projects.slice(0, 6).map(p \=\> (

                \<button key={p.id}

                  className='w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent flex items-center gap-2'

                  onClick={() \=\> {

                    setInput(prev \=\> prev \+ (prev ? ' ' : '') \+ \`\[Projeto: ${p.name}\]\`)

                    setShowProjects(false)

                  }}\>

                  \<FolderOpen className='h-3 w-3 text-muted-foreground' /\> {p.name}

                \</button\>

              ))}

            \</div\>

          )}

        \</div\>

        {/\* Spacer \*/}

        \<div className='flex-1' /\>

        {/\* Botão enviar \*/}

        \<Button

          size='sm'

          className='h-8 w-8 rounded-full p-0'

          onClick={handleSendAndCreate}

          disabled={isPending || \!input.trim()}

          data-testid='button-super-agent-send'

        \>

          {isPending ? \<Loader2 className='h-4 w-4 animate-spin' /\> : \<Send className='h-4 w-4' /\>}

        \</Button\>

      \</div\>

    \</div\>

  )

}

## **2.6 — Input da conversa ativa: manter SessionFiles \+ melhorar barra**

Quando há sessão ativa, o input existente (Textarea \+ botão Send) já funciona bem. Apenas melhorar o visual para ficar consistente com o WelcomeInput:

// Na área de input do ChatPanel (quando há sessão ativa),

// substituir o 'border-t p-2 flex gap-2' por uma estrutura com borda arredondada:

// era:

\<div className='border-t p-2 flex gap-2'\>

  \<Textarea ... className='min-h-\[44px\] max-h-32 resize-none text-sm' /\>

  \<Button ...\>\<Send /\>\</Button\>

\</div\>

// vira:

\<div className='border-t p-3'\>

  \<div className='border rounded-xl bg-background overflow-hidden'\>

    \<Textarea

      value={input}

      onChange={e \=\> setInput(e.target.value)}

      onKeyDown={e \=\> { if (e.key \=== 'Enter' && \!e.shiftKey) { e.preventDefault(); handleSend() } }}

      placeholder={projectId ? 'Pergunte sobre este projeto...' : 'Pergunte sobre seus projetos, clientes, ERP...'}

      className='min-h-\[52px\] max-h-36 resize-none border-0 rounded-none focus-visible:ring-0 text-sm px-4 pt-3'

      disabled={isPending}

      data-testid='textarea-super-agent-input'

    /\>

    \<div className='flex items-center gap-2 px-3 py-2 border-t bg-muted/20'\>

      \<span className='text-\[10px\] text-muted-foreground'\>Enter para enviar · Shift+Enter para nova linha\</span\>

      \<div className='flex-1' /\>

      \<Button

        size='sm' className='h-7 w-7 rounded-full p-0'

        onClick={handleSend}

        disabled={isPending || \!input.trim()}

        data-testid='button-super-agent-send'

      \>

        {isPending ? \<Loader2 className='h-3.5 w-3.5 animate-spin' /\> : \<Send className='h-3.5 w-3.5' /\>}

      \</Button\>

    \</div\>

  \</div\>

\</div\>

## **2.7 — Redesign do TaskPane (painel direito)**

O TaskPane atual já funciona. Apenas ajustar para não ter border-radius e ter borda esquerda ao invés de borda completa (espelho da sidebar):

// era: 'hidden lg:flex w-80 flex-shrink-0 border rounded-md flex-col bg-card'

// vira: 'hidden lg:flex w-72 flex-shrink-0 border-l flex-col bg-muted/20'

// Header do TaskPane — manter estrutura, apenas ajustar:

// era: 'p-3 border-b flex items-start gap-2'

// vira: 'px-4 py-3 border-b flex items-center gap-2'

// Título: 'Execução ao vivo' (era 'Tarefa atual')

// Subtítulo remover (economizar espaço)

// Adicionar seção de 'Contexto ativo' abaixo de Passos e acima de Artefatos:

// Mostra se há projeto/agente vinculado à sessão atual

# **PARTE 3 — MessageBubble: melhorar renderização**

A renderização de mensagens atual usa whitespace-pre-wrap simples. Melhorar para renderizar Markdown básico nas mensagens do assistente:

// Adicionar dependência se não existir: já deve ter react-markdown ou similar no projeto.

// Verificar se react-markdown está no package.json antes de instalar.

// Se react-markdown disponível, na MessageBubble:

// era: \<div className='whitespace-pre-wrap'\>{visibleText}\</div\>

// vira (apenas para mensagens do assistente):

isUser

  ? \<div className='whitespace-pre-wrap text-sm'\>{visibleText}\</div\>

  : \<div className='prose prose-sm dark:prose-invert max-w-none text-sm'\>

      {/\* usar dangerouslySetInnerHTML com markdown parser simples, ou prose classes do Tailwind Typography \*/}

      \<div className='whitespace-pre-wrap leading-relaxed'\>{visibleText}\</div\>

    \</div\>

// Se react-markdown NÃO estiver disponível, manter whitespace-pre-wrap

// mas melhorar as classes:

// era: 'whitespace-pre-wrap'

// vira: 'whitespace-pre-wrap leading-relaxed text-sm'

# **O QUE NÃO MUDAR**

\- Toda a lógica de streaming SSE (runStream, abortRef, streamSteps) — não tocar

\- O parser e card de scrum-plan (parseScrumPlan, ScrumPlanCard) — não tocar

\- A lógica de upload de arquivos em SessionFiles — não tocar

\- Todos os data-testid existentes — manter para não quebrar testes

\- O modo compact (usado em floating e embed) — não tocar, apenas garantir que continua funcionando

\- As funções useMutation e useQuery — não refatorar

\- A lógica de grupos de sessões (general \+ projectGroups) na sidebar — não tocar

\- O componente AppSidebar/layout global da aplicação — a mudança é DENTRO do super-agente, não no layout global

# **CRITÉRIO DE ACEITAÇÃO**

1\. /super-agente ocupa 100% da altura disponível sem scroll na página (o chat scrolla internamente).

2\. Tela de boas-vindas aparece quando não há sessão ativa, com input centralizado grande e 4 sugestões de ações rápidas.

3\. Input da boas-vindas tem botão de Agente e Projeto com dropdown ao clicar.

4\. Quando sessão ativa: layout 3 colunas (sidebar | chat | task pane) ocupa 100% sem gaps.

5\. Sidebar sem border-radius nas bordas que tocam as extremidades (apenas border-r).

6\. Todas as funcionalidades existentes funcionam: criar sessão, trocar agente, upload de arquivo, streaming, scrum-plan.

7\. Modo compact (usado em embeds) continua funcionando sem alteração.

8\. App sobe sem erros TypeScript.