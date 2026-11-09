const quoteShell=value=>"'"+value.replaceAll("'","'\\''")+"'";
const quoteUnit=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';

export function launchFiles({root,node,app,codexHome}) {
 for(const value of [root,node,app,codexHome])if(/[\x00-\x1f\x7f]/.test(value))throw new Error('Installation paths must not contain control characters.');
 return {
  cli:'#!/bin/sh\nexec '+quoteShell(node)+' '+quoteShell(root+'/stdio-relay.mjs')+' "$@"\n',
  desktop:[
   '#!/bin/sh',
   'export CODEX_HOME='+quoteShell(codexHome),
   'export CODEX_CLI_PATH='+quoteShell(root+'/codex-telegram-cli'),
   'export CODEX_APP_SERVER_FORCE_CLI=1',
   'exec '+quoteShell(app)+' "$@"',
   '',
  ].join('\n'),
  unit:[
   '[Unit]',
   'Description=Codex Telegram Bridge for Ubuntu Desktop',
   '',
   '[Service]',
   'ExecStart=:'+quoteUnit(node)+' --use-env-proxy '+quoteUnit(root+'/daemon.mjs'),
   'UMask=0077',
   'Restart=on-failure',
   'RestartSec=3',
   'KillMode=control-group',
   '',
   '[Install]',
   'WantedBy=default.target',
   '',
  ].join('\n'),
 };
}
