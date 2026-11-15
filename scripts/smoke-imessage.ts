// Smoke test for iMessage: prints new inbound messages for 60 s (last 4 digits only).
// Usage: npm run smoke:imessage [-- --reply]   (--reply answers each message with "smoke test ok")
// Needs the Chert variables (see --help) in the environment.
// TO VERIFY ON THE REAL LINE: inbound texts show up within a few seconds; replies arrive on the phone.
import { loadEnv } from '../src/config';
import { createChertClient } from '../src/comms/chert';
import { createMessagePort } from '../src/comms/imessage';

const USAGE = `Usage: npm run smoke:imessage [-- --reply]
Prints new inbound messages for 60 seconds (last 4 digits of the sender only).
  --reply   answer each message with "smoke test ok"
  --help    show this text
Needs CHERT_API_KEY, CHERT_PROJECT_ID and CHERT_LINE_ID.`;

const WATCH_MS = 60_000;

async function main(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
  const env = loadEnv(process.env, { readDotenv: true });
  const need: [string, string][] = [['CHERT_API_KEY', env.chertApiKey], ['CHERT_PROJECT_ID', env.chertProjectId], ['CHERT_LINE_ID', env.chertLineId]];
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { console.error(`Missing ${missing.join(', ')}.`); return 1; }
  const reply = args.includes('--reply');
  console.log(`Watching inbound messages for ${WATCH_MS / 1000} s${reply ? ', replying "smoke test ok"' : ''}...`);
  const chert = createChertClient({
    apiKey: env.chertApiKey, projectId: env.chertProjectId, lineId: env.chertLineId,
    facetimeBase: env.chertFacetimeBase, appBase: env.chertAppBase,
  });
  const port = createMessagePort({ chert });
  port.onMessage((m) => {
    console.log(`inbound from ...${m.phone.slice(-4)}: ${m.text.length} chars`);
    if (reply) port.send(m.phone, 'smoke test ok', `smoke-${m.id}`).catch((e: unknown) => console.error('reply failed:', e instanceof Error ? e.message : e));
  });
  port.start();
  await new Promise((r) => setTimeout(r, WATCH_MS));
  port.stop();
  console.log('Done.');
  return 0;
}

if (process.argv[1]?.endsWith('smoke-imessage.ts')) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => { console.error(e instanceof Error ? e.message : 'Smoke failed'); process.exitCode = 1; });
}
