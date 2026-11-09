import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

/** A distinct short-lived vendor protocol client for isolated qualification. */
export class CliRpc extends EventEmitter {
  constructor({ executable, args, cwd, env = process.env }) {
    super();
    this.pending = new Map();
    this.next = 1;
    this.child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.method) { this.emit('message', m); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(Object.assign(new Error(m.error.message), { rpcCode: m.error.code }));
      else p.resolve(m.result);
    });
    this.child.on('error', e => this.rejectPending(e));
    this.child.on('exit', code => this.rejectPending(new Error(`Qualification CLI exited (${code}).`)));
  }
  send(m) { this.child.stdin.write(JSON.stringify(m) + '\n'); }
  request(method, params = {}, timeoutMs = 30_000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  async initialize() {
    const r = await this.request('initialize', { clientInfo: { name: 'codex-telegram-qualification', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
    return r;
  }
  rejectPending(e) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
  }
  async close() {
    this.rejectPending(new Error('Qualification client closed.'));
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 3000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
