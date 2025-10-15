#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const changed = () => execSync('git diff --name-only origin/main...HEAD',{stdio:['ignore','pipe','pipe']}).toString().trim().split('\n').filter(Boolean);
function readJSONAtRef(ref, path){ try{ return JSON.parse(execSync(`git show ${ref}:${path}`,{stdio:['ignore','pipe','pipe']}).toString()); }catch{return null;} }
function classify(oldJs, newJs){
  if (!oldJs) return 'minor';
  const oP = oldJs.properties??{}, nP = newJs.properties??{};
  const oR = new Set(oldJs.required??[]), nR = new Set(newJs.required??[]);
  for (const k of Object.keys(oP)) if (!(k in nP)) return 'major';
  for (const k of Object.keys(nP)) if (k in oP){
    const o = JSON.stringify(oP[k]), n = JSON.stringify(nP[k]);
    if (o!==n){
      const oe = Array.isArray(oP[k].enum)? new Set(oP[k].enum) : null;
      const ne = Array.isArray(nP[k].enum)? new Set(nP[k].enum) : null;
      if (oe && ne){ const sup = [...oe].every(v=>ne.has(v)); if (sup && ne.size>=oe.size) continue; }
      return 'major';
    }
  }
  for (const k of nR) if (!oR.has(k)) return 'major';
  const added = Object.keys(nP).filter(k=>!(k in oP));
  if (added.length) return added.some(k=>nR.has(k)) ? 'major':'minor';
  return 'patch';
}
function rank(a){ return {none:0,patch:1,minor:2,major:3}[a]; }
function bumpFrom(a,b){ return rank(a)>=rank(b)?a:b; }
function parse(v){ const m=String(v).match(/^(\\d+)\\.(\\d+)\\.(\\d+)/); return m?{M:+m[1],m:+m[2],p:+m[3]}:null; }
function cmp(oldV, newV){ const o=parse(oldV), n=parse(newV); if(!o||!n) return 'invalid'; if(n.M>o.M) return 'major'; if(n.M===o.M && n.m>o.m) return 'minor'; if(n.M===o.M && n.m===o.m && n.p>o.p) return 'patch'; return 'none-or-down'; }
const files = changed();
const schemaFiles = files.filter(f=>f.startsWith('contracts/schema/'));
let required='none';
for(const f of schemaFiles){
  const oldJ = readJSONAtRef('origin/main', f);
  const newJ = JSON.parse(fs.readFileSync(f,'utf-8'));
  const c = classify(oldJ, newJ);
  required = bumpFrom(required, c);
  console.log(`Schema change ${f}: ${c}`);
}
let oldV='0.0.0'; try{ oldV = JSON.parse(execSync('git show origin/main:contracts/package.json',{stdio:['ignore','pipe','pipe']}).toString()).version; }catch{}
const newV = JSON.parse(fs.readFileSync('contracts/package.json','utf-8')).version;
const bump = cmp(oldV, newV);
console.log(`Highest required: ${required}`); console.log(`contracts version: ${oldV} -> ${newV} (${bump})`);
function fail(m){ console.error('❌ '+m); process.exit(1); } function ok(m){ console.log('✅ '+m); process.exit(0); }
if(required==='none'){ if(bump!=='none-or-down' && bump!=='patch') console.warn('⚠️ non-patch bump without schema change'); ok('no schema changes'); }
if(required==='patch'){ if(['patch','minor','major'].includes(bump)) ok('patch ok'); else fail('patch change needs version bump'); }
if(required==='minor'){ if(['minor','major'].includes(bump)) ok('minor ok'); else fail('additive change needs minor bump'); }
if(required==='major'){ if(bump==='major') ok('major ok'); else fail('breaking change needs MAJOR bump'); }
