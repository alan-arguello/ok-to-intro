import { Tag } from '@/components/kit/pills';
import { Trace } from '@/components/kit/blocks';
import { Disclosure, List, Row, RowLine1 } from '@/components/kit/surfaces';
import { OPEN_TOOL_COUNT, TOOL_CATALOG, TOKEN_TOOL_COUNT } from '@/lib/mcp/catalog';
import { INSTALL_MCP_COMMAND, INSTALL_PLUGIN_COMMAND, INSTALL_PLUGIN_TWO_STEP } from '@/lib/site';
import { AgentTabs } from './agent-tabs';
import { AGENTS_COPY as C } from './copy';
import { CopyCommand } from './copy-command';
import { type DemoKey, errorExamples, hookExample, toolExamples, transcripts } from './examples';
import { ReceiptLines, TranscriptLines } from './receipt';

/**
 * S6 · /agents (ux-spec S6, prototype agents.html): install (plugin or MCP only, commands from lib/site.ts), what you
 * get, three example transcripts, the 9 tools with an example result each, the error results and the session hook.
 * A server component: every receipt is rendered at build by lib/receipts.ts from SAMPLE data; only the tabs and the
 * Copy buttons are client islands.
 */
export function AgentsPage() {
  const demos = transcripts();
  const examples = toolExamples();
  const sampleOpen = TOOL_CATALOG.filter((t) => t.sampleOpen).map((t) => t.name);

  const demoPanel = (key: DemoKey) => {
    const t = demos[key];
    const shown = t.cut === null ? t.rows : t.rows.slice(0, t.cut);
    const rest = t.cut === null ? [] : t.rows.slice(t.cut);
    return (
      <div className="ag-panel">
        {/* The tab panel itself takes focus (kit Tabs); the transcript doesn't scroll, so it isn't a second stop. */}
        <pre className="trace ag-tr">
          <TranscriptLines rows={shown} />
        </pre>
        {rest.length ? (
          <Disclosure className="ag-more" summary={C.showRest}>
            <pre className="trace ag-tr">
              <TranscriptLines rows={rest} />
            </pre>
          </Disclosure>
        ) : null}
      </div>
    );
  };

  return (
    <div className="container container--col">
      <header className="page-head">
        <h1 className="h1">{C.title}</h1>
        <p className="lede">{C.lede}</p>
      </header>

      <section className="ag-sec" aria-labelledby="ag-install-h">
        <h2 className="h2" id="ag-install-h">
          {C.install}
        </h2>
        <AgentTabs
          param="tab"
          fallback="plugin"
          label={C.install}
          items={[
            {
              key: 'plugin',
              label: C.pluginTab,
              panel: (
                <div className="ag-panel">
                  <CopyCommand command={INSTALL_PLUGIN_COMMAND} label={C.copyPlugin} primary />
                  <p className="help">{C.pluginHelp}</p>
                  <Disclosure className="ag-more" summary={C.olderSummary}>
                    <div className="stack">
                      <CopyCommand command={INSTALL_PLUGIN_TWO_STEP[0]} label={C.copyMarketplace} />
                      <CopyCommand command={INSTALL_PLUGIN_TWO_STEP[1]} label={C.copyInstall} />
                      <p className="help">{C.olderHelp}</p>
                    </div>
                  </Disclosure>
                </div>
              ),
            },
            {
              key: 'mcp',
              label: C.mcpTab,
              panel: (
                <div className="ag-panel">
                  <CopyCommand command={INSTALL_MCP_COMMAND} label={C.copyMcp} primary />
                  <p className="help">{C.mcpHelp}</p>
                </div>
              ),
            },
          ]}
        />
      </section>

      <section className="section ag-sec" aria-labelledby="ag-get-h">
        <h2 className="h2" id="ag-get-h">
          {C.whatYouGet}
        </h2>
        <List className="ag-get">
          <Row>
            <p className="small">
              <b>{C.getMcp}</b> · {TOOL_CATALOG.length} tools: {OPEN_TOOL_COUNT} open, {TOKEN_TOOL_COUNT} with your token ({sampleOpen.join(' and ')} also {sampleOpen.length === 1 ? 'works' : 'work'} without one on SAMPLE)
            </p>
          </Row>
          <Row>
            <p className="small">
              <b>{C.getSkill}</b> · {C.getSkillWhat}
            </p>
          </Row>
          <Row>
            <p className="small">
              <b>{C.getHook}</b> · {C.getHookWhat}
            </p>
          </Row>
        </List>
      </section>

      <section className="section ag-sec" aria-labelledby="ag-demo-h">
        <div className="ag-demo-head">
          <h2 className="h2" id="ag-demo-h">
            {C.seeItWork}
          </h2>
          <Tag>Sample</Tag>
        </div>
        <AgentTabs
          param="demo"
          fallback="ask"
          label={C.seeItWork}
          items={[
            { key: 'ask', label: C.demoAsk, panel: demoPanel('ask') },
            { key: 'asked', label: C.demoAsked, panel: demoPanel('asked') },
            { key: 'try', label: C.demoTry, panel: demoPanel('try') },
          ]}
        />
        <p className="help ag-cap">{C.transcriptsCaption}</p>
      </section>

      <section className="section ag-sec" aria-labelledby="ag-tools-h">
        <h2 className="h2" id="ag-tools-h">
          {C.tools}
        </h2>
        <List>
          {TOOL_CATALOG.map((t) => (
            <Row key={t.name} className="ag-tool">
              <RowLine1 as="p">
                <code className="ag-tool__name">{t.name}</code>
                {t.access === 'open' ? <Tag>Open</Tag> : <Tag kind="outline">Token</Tag>}
                {t.sampleOpen ? <Tag>Sample: open</Tag> : null}
              </RowLine1>
              <p className="ag-tool__what">{t.what}</p>
              {t.requiresUserInteraction ? <p className="ag-tool__note">{C.asksFirst}</p> : null}
              <Disclosure
                summary={
                  <>
                    {C.exampleResult}
                    <span className="sr-only"> for {t.name}</span>
                  </>
                }
              >
                <div className="stack">
                  {examples[t.name].map((text, i) => (
                    <Trace key={i} label={`Example result: ${t.name}`}>
                      <ReceiptLines lines={text.split('\n')} />
                    </Trace>
                  ))}
                </div>
              </Disclosure>
            </Row>
          ))}
        </List>
        <Disclosure className="ag-more" summary={C.errors}>
          <div className="stack">
            <Trace label="Error results">
              <ReceiptLines lines={errorExamples()} />
            </Trace>
          </div>
        </Disclosure>
      </section>

      <section className="section ag-sec" aria-labelledby="ag-hook-h">
        <h2 className="h2" id="ag-hook-h">
          {C.hook}
        </h2>
        <List className="ag-hook">
          {C.hookRules.map((r) => (
            <Row key={r}>{r}</Row>
          ))}
        </List>
        <Trace className="ag-hook-tr" label="Example session hook lines">
          <ReceiptLines lines={hookExample()} />
        </Trace>
        <p className="help ag-cap ag-hook-cap">{C.hookCaption}</p>
      </section>
    </div>
  );
}
