/**
 * THE SKILL GRAPH — one continuous DAG from preschool (age 5) to одделение 9 (age 14).
 *
 * Sequencing is a best-effort reconstruction of the North Macedonian nine-year
 * primary curriculum (see DESIGN.md §0 A-7). Band is an attribute of each node;
 * unlocking is by prerequisites only, so a strong child walks from Band B into
 * Band C content without any wall.
 *
 * To add a skill: add one line here, add `skill.<id>` names to every locale
 * bundle, and (optionally) bind a generator. See CONTRIBUTING.md.
 */
import type { BandId, SkillId, Strand } from '../types';
import type { GeneratorBinding, SkillDef, SkillTag } from './types';

function s(
  id: SkillId,
  strand: Strand,
  grade: number,
  band: BandId,
  prereqs: SkillId[],
  tags: SkillTag[] = [],
  gens?: GeneratorBinding[],
): SkillDef {
  return gens ? { id, strand, grade, band, prereqs, tags, gens } : { id, strand, grade, band, prereqs, tags };
}

const g = (id: string, config?: Record<string, unknown>, weight?: number): GeneratorBinding =>
  weight === undefined ? (config ? { id, config } : { id }) : { id, config: config ?? {}, weight };

export const SKILLS: readonly SkillDef[] = [
  // ───────────────────────── Band A · preschool (age 5) ─────────────────────────
  s('num.subitize.5', 'number', 0.0, 'A', [], ['visual'], [g('count', { max: 5, layouts: ['dice', 'frame'] })]),
  s('num.count.10', 'number', 0.0, 'A', [], [], [g('count', { max: 10, layouts: ['dice', 'frame', 'scatter'] })]),
  s('geo.shapes.basic', 'geometry', 0.1, 'A', [], ['visual']),
  s('pat.repeat', 'patterns', 0.2, 'A', [], ['visual']),
  s('num.compare.10', 'number', 0.3, 'A', ['num.count.10']),
  s('num.line.10', 'number', 0.4, 'A', ['num.count.10'], [], [g('locate', { min: 0, max: 10 })]),
  s('num.subitize.10', 'number', 0.6, 'A', ['num.subitize.5'], ['visual'], [g('count', { max: 10, layouts: ['frame', 'dice'] })]),
  s('meas.compare', 'measurement', 0.8, 'A', [], ['visual']),
  // ───────────────────────── Band A · одделение 1 (age 6) ───────────────────────
  s('num.count.20', 'number', 1.0, 'A', ['num.count.10'], [], [g('count', { max: 20, layouts: ['frame', 'scatter'] })]),
  s('as.bonds.5', 'addsub', 1.0, 'A', ['num.subitize.5', 'num.count.10'], ['fluency'], [g('bonds', { total: 5 })]),
  s('as.add.10', 'addsub', 1.1, 'A', ['as.bonds.5'], ['fluency'], [g('addsub', { op: '+', range: 10 })]),
  s('as.bonds.10', 'addsub', 1.2, 'A', ['as.bonds.5', 'num.subitize.10'], ['fluency'], [g('bonds', { total: 10 })]),
  s('as.sub.10', 'addsub', 1.3, 'A', ['as.add.10'], ['fluency'], [g('addsub', { op: '-', range: 10 })]),
  s('num.line.20', 'number', 1.3, 'A', ['num.line.10', 'num.count.20'], [], [g('locate', { min: 0, max: 20 })]),
  s('num.compare.20', 'number', 1.4, 'A', ['num.compare.10', 'num.count.20']),
  s('geo.shapes.props', 'geometry', 1.5, 'A', ['geo.shapes.basic'], ['visual']),
  s('as.add.20', 'addsub', 1.6, 'A', ['as.add.10', 'as.bonds.10', 'num.line.20'], ['fluency'], [g('addsub', { op: '+', range: 20 })]),
  s('pat.grow', 'patterns', 1.7, 'A', ['pat.repeat', 'num.count.20']),
  s('as.sub.20', 'addsub', 1.8, 'A', ['as.sub.10', 'as.add.20'], ['fluency'], [g('addsub', { op: '-', range: 20 })]),
  // ───────────────────────── Band A · одделение 2 (age 7) ───────────────────────
  s('pv.tens.100', 'placevalue', 2.0, 'A', ['num.count.20'], ['visual'], [g('blocks', { max: 100 })]),
  s('num.line.100', 'number', 2.1, 'A', ['num.line.20', 'pv.tens.100'], [], [g('locate', { min: 0, max: 100 })]),
  s('as.add.100.noregroup', 'addsub', 2.2, 'A', ['as.add.20', 'pv.tens.100'], [], [
    g('addsub', { op: '+', range: 100, regroup: 'never' }),
  ]),
  s('as.sub.100.noregroup', 'addsub', 2.3, 'A', ['as.sub.20', 'pv.tens.100'], [], [
    g('addsub', { op: '-', range: 100, regroup: 'never' }),
  ]),
  s('meas.time.hour', 'measurement', 2.3, 'A', ['num.count.20'], ['visual']),
  s('meas.money', 'measurement', 2.4, 'A', ['as.add.100.noregroup']),
  s('as.add.100', 'addsub', 2.5, 'A', ['as.add.100.noregroup', 'num.line.100'], [], [
    g('addsub', { op: '+', range: 100, regroup: 'required' }, 4),
    g('word', { template: 'wp.save', base: { id: 'addsub', config: { op: '+', range: 100, regroup: 'required' } } }, 1),
  ]),
  s('meas.length', 'measurement', 2.5, 'A', ['num.line.20']),
  s('md.groups', 'muldiv', 2.6, 'A', ['as.add.20'], ['visual'], [g('groups', { maxGroups: 5, maxSize: 5 })]),
  s('as.sub.100', 'addsub', 2.7, 'A', ['as.sub.100.noregroup', 'as.add.100'], [], [
    g('addsub', { op: '-', range: 100, regroup: 'required' }, 4),
    g('word', { template: 'wp.market', base: { id: 'addsub', config: { op: '-', range: 100, regroup: 'required' } } }, 1),
  ]),
  s('md.mult.2510', 'muldiv', 2.8, 'A', ['md.groups'], ['fluency'], [g('mult', { factors: [2, 5, 10] })]),

  // ───────────────────────── Band B · одделение 3 (age 8) ───────────────────────
  s('pv.1000', 'placevalue', 3.0, 'B', ['pv.tens.100'], ['visual'], [g('blocks', { max: 1000 })]),
  s('num.line.1000', 'number', 3.1, 'B', ['num.line.100', 'pv.1000'], ['estimation'], [
    g('locate', { min: 0, max: 1000, tolerancePct: 0.03 }),
  ]),
  s('as.add.multi', 'addsub', 3.2, 'B', ['as.add.100', 'pv.1000'], [], [
    g('addsub', { op: '+', range: 1000 }, 4),
    g('word', { template: 'wp.trip', base: { id: 'addsub', config: { op: '+', range: 1000 } } }, 1),
  ]),
  s('md.mult.facts', 'muldiv', 3.3, 'B', ['md.mult.2510'], ['fluency'], [
    g('mult', {}, 5),
    g('word', { template: 'wp.rows', base: { id: 'mult', config: { minFactor: 2 } } }, 1),
  ]),
  s('dp.pictograph', 'data', 3.3, 'B', ['as.add.100.noregroup'], ['visual', 'reading']),
  s('as.sub.multi', 'addsub', 3.4, 'B', ['as.sub.100', 'as.add.multi'], [], [
    g('addsub', { op: '-', range: 1000 }, 4),
    g('word', { template: 'wp.bus', base: { id: 'addsub', config: { op: '-', range: 1000 } } }, 1),
  ]),
  s('meas.time.min', 'measurement', 3.4, 'B', ['meas.time.hour']),
  s('md.div.facts', 'muldiv', 3.5, 'B', ['md.mult.facts'], ['fluency'], [
    g('div', {}, 5),
    g('word', { template: 'wp.share', base: { id: 'div', config: { minFactor: 2 } } }, 1),
  ]),
  s('f.unit', 'fractions', 3.6, 'B', ['md.groups'], ['visual']),
  s('md.mult.10s', 'muldiv', 3.6, 'B', ['md.mult.facts', 'pv.1000'], [], [g('mult10s', {})]),
  s('geo.perimeter', 'geometry', 3.8, 'B', ['as.add.multi', 'meas.length']),
  // ───────────────────────── Band B · одделение 4 (age 9) ───────────────────────
  s('pv.big', 'placevalue', 4.0, 'B', ['pv.1000']),
  s('md.mult.multi', 'muldiv', 4.2, 'B', ['md.mult.10s', 'as.add.multi'], [], [g('multMulti', {})]),
  s('f.of.set', 'fractions', 4.2, 'B', ['f.unit', 'md.div.facts']),
  s('md.div.remainder', 'muldiv', 4.3, 'B', ['md.div.facts', 'md.mult.10s']),
  s('dp.bar', 'data', 4.3, 'B', ['dp.pictograph'], ['reading']),
  s('geo.area.rect', 'geometry', 4.4, 'B', ['md.mult.facts', 'geo.perimeter']),
  s('md.factors', 'muldiv', 4.5, 'B', ['md.mult.facts', 'md.div.facts']),
  s('f.equiv', 'fractions', 4.5, 'B', ['f.unit', 'md.mult.facts'], ['visual']),
  s('meas.convert', 'measurement', 4.5, 'B', ['md.mult.10s']),
  s('f.compare', 'fractions', 4.6, 'B', ['f.equiv']),
  s('geo.angles', 'geometry', 4.6, 'B', ['geo.shapes.props'], ['visual']),
  // ───────────────────────── Band B · одделение 5 (age 10) ──────────────────────
  s('f.add.like', 'fractions', 5.0, 'B', ['f.equiv']),
  s('md.div.long', 'muldiv', 5.2, 'B', ['md.div.remainder', 'md.mult.multi']),
  s('d.tenths', 'decimals', 5.2, 'B', ['f.equiv', 'pv.big']),
  s('md.primes', 'muldiv', 5.3, 'B', ['md.factors']),
  s('d.compare', 'decimals', 5.3, 'B', ['d.tenths']),
  s('wp.multistep', 'addsub', 5.4, 'B', ['md.mult.multi', 'as.sub.multi'], ['reading']),
  s('f.add.unlike', 'fractions', 5.5, 'B', ['f.add.like', 'md.factors']),
  s('d.addsub', 'decimals', 5.5, 'B', ['d.tenths', 'as.add.multi']),
  s('geo.area.composite', 'geometry', 5.6, 'B', ['geo.area.rect']),
  s('dp.mean', 'data', 5.7, 'B', ['md.div.remainder', 'dp.bar']),
  // ───────────────────────── Band B · одделение 6 (age 11) ──────────────────────
  s('oo.basic', 'algebra', 6.0, 'B', ['md.mult.facts', 'md.div.facts', 'as.sub.multi']),
  s('f.mult', 'fractions', 6.0, 'B', ['f.of.set', 'f.add.like']),
  s('d.multdiv', 'decimals', 6.1, 'B', ['d.addsub', 'md.mult.multi']),
  s('num.gcd.lcm', 'muldiv', 6.2, 'B', ['md.primes']),
  s('f.div', 'fractions', 6.3, 'B', ['f.mult']),
  s('meas.convert.decimal', 'measurement', 6.3, 'B', ['meas.convert', 'd.multdiv']),
  s('d.percent', 'decimals', 6.4, 'B', ['d.tenths', 'f.equiv']),
  s('geo.triangles', 'geometry', 6.4, 'B', ['geo.angles', 'geo.area.rect']),
  s('geo.volume.cuboid', 'geometry', 6.5, 'B', ['geo.area.rect']),
  s('al.expr.intro', 'algebra', 6.6, 'B', ['oo.basic']),

  // ───────────────────────── Band C · одделение 7 (age 12) ──────────────────────
  s('int.intro', 'integers', 7.0, 'C', ['num.line.1000'], [], [g('locate', { min: -10, max: 10 })]),
  s('int.addsub', 'integers', 7.1, 'C', ['int.intro', 'as.sub.multi'], ['fluency'], [g('intAddSub', {})]),
  s('r.ratio', 'ratio', 7.2, 'C', ['f.equiv', 'md.mult.facts']),
  s('oo.full', 'algebra', 7.2, 'C', ['oo.basic', 'int.addsub']),
  s('geo.coord', 'geometry', 7.3, 'C', ['int.intro'], ['visual']),
  s('int.multdiv', 'integers', 7.3, 'C', ['int.addsub', 'md.mult.facts'], ['fluency']),
  s('al.eq.onestep', 'algebra', 7.4, 'C', ['al.expr.intro', 'int.addsub']),
  s('rat.ops', 'integers', 7.5, 'C', ['int.multdiv', 'f.div', 'd.multdiv']),
  s('dp.prob.basic', 'data', 7.5, 'C', ['f.equiv', 'f.compare']),
  s('r.proportion', 'ratio', 7.6, 'C', ['r.ratio']),
  s('d.percent.change', 'decimals', 7.7, 'C', ['d.percent', 'r.ratio']),
  s('geo.circle', 'geometry', 7.8, 'C', ['d.multdiv']),
  // ───────────────────────── Band C · одделение 8 (age 13) ──────────────────────
  s('pw.powers', 'algebra', 8.0, 'C', ['int.multdiv', 'oo.full']),
  s('al.expr.simplify', 'algebra', 8.0, 'C', ['al.expr.intro', 'int.multdiv']),
  s('pw.roots', 'algebra', 8.1, 'C', ['pw.powers']),
  s('al.eq.linear', 'algebra', 8.2, 'C', ['al.eq.onestep', 'rat.ops']),
  s('dp.stats', 'data', 8.3, 'C', ['dp.mean', 'rat.ops']),
  s('geo.pythag', 'geometry', 8.4, 'C', ['pw.roots', 'geo.triangles']),
  s('al.ineq', 'algebra', 8.5, 'C', ['al.eq.linear']),
  s('geo.surface', 'geometry', 8.6, 'C', ['geo.volume.cuboid', 'geo.circle']),
  s('num.sci', 'number', 8.7, 'C', ['pw.powers']),
  // ───────────────────────── Band C · одделение 9 (age 14) ──────────────────────
  s('fn.intro', 'algebra', 9.0, 'C', ['geo.coord', 'al.eq.linear']),
  s('al.polynomials', 'algebra', 9.0, 'C', ['al.expr.simplify', 'pw.powers']),
  s('geo.volume.solids', 'geometry', 9.2, 'C', ['geo.surface', 'pw.powers']),
  s('fn.linear', 'algebra', 9.3, 'C', ['fn.intro']),
  s('geo.similar', 'geometry', 9.3, 'C', ['r.proportion', 'geo.triangles']),
  s('al.systems', 'algebra', 9.4, 'C', ['al.eq.linear', 'fn.intro']),
  s('dp.prob.compound', 'data', 9.5, 'C', ['dp.prob.basic', 'f.mult']),
];
