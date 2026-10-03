/**
 * Stamp-act articles offered on the e-Stamp order form, per state.
 *
 * Sources (official):
 *  - Karnataka, Delhi, Uttar Pradesh: NeSL "List of articles … with Digital Codes" (Jan 2025)
 *  - Telangana: NeSL Communiqué #105 (Nov 2023)
 *  - Karnataka duty rules: Karnataka Gazette No. DPAL 39 SHASANA 2023 (03-02-2024),
 *    as published in NeSL Communiqué #127 (Feb 2024)
 *  - Lease article 35 (Delhi, Uttar Pradesh): Indian Stamp Act, 1899, Schedule I
 *
 * Article numbers DIFFER between states, so only verified states have an article list.
 * Every other state shows plain document types and our team confirms the article.
 * ⚠ COPY of LauncherDesk-frontend/src/data/estampArticles.js — keep both in sync.
 *
 * rule (optional) — how the stamp duty is worked out:
 *   { type: 'fixed', amount }                               duty is always `amount`
 *   { type: 'percent', rate, min?, max?, base, baseMin?, baseMax? }   rate% of the base amount
 *   { type: 'per', every, amount, base, baseMin?, baseMax? }          ₹amount for every ₹every (or part)
 *   { type: 'text', text }                                   shown to the customer, duty entered manually
 */
const STATE_ARTICLES = {
  karnataka: [
    { code: '4', label: 'Affidavit', rule: { type: 'fixed', amount: 100 } },
    { code: '5(J)', label: 'Agreement (in any other cases)', rule: { type: 'fixed', amount: 500 } },
    { code: '30(1)(i)', label: 'Lease of immovable property, up to 1 year, residential', hint: 'Most rent agreements' },
    { code: '30(1)(ii)', label: 'Lease of immovable property, up to 1 year, commercial or industrial' },
    { code: '41(c)', label: 'Power of Attorney, authorising more than 5 persons to act jointly', rule: { type: 'fixed', amount: 500 } },
    { code: '41(e)', label: 'Power of Attorney, authorising sale of property', rule: { type: 'percent', rate: 5, base: 'Market value of the property' } },
    { code: '41(eb)', label: 'Power of Attorney, sale power given to other than family members', rule: { type: 'percent', rate: 5, base: 'Market value of the property' } },
    { code: '29', label: 'Indemnity Bond', rule: { type: 'percent', rate: 2, max: 500, base: 'Consideration amount' } },
    { code: '1(i)(a)', label: 'Acknowledgement of a debt, up to ₹5,000', rule: { type: 'fixed', amount: 2 } },
    { code: '1(i)(b)', label: 'Acknowledgement of a debt, more than ₹5,000', rule: { type: 'text', text: '₹2, plus ₹2 for every ₹1,000 or part of it, up to ₹1,000.' } },
    { code: '6(1)(ii)', label: 'Agreement relating to deposit of title deeds, loan up to ₹10 lakh', rule: { type: 'percent', rate: 0.5, min: 500, base: 'Loan amount', baseMax: 1000000 } },
    { code: '6(i)(ii)', label: 'Agreement relating to deposit of title deeds, loan above ₹10 lakh', rule: { type: 'percent', rate: 0.5, base: 'Loan amount', baseMin: 1000001 } },
    { code: '6(2)(i)', label: 'Pawn or pledge of movable property, loan above ₹1 lakh up to ₹10 lakh', rule: { type: 'percent', rate: 0.5, base: 'Loan amount', baseMin: 100001, baseMax: 1000000 } },
    { code: '6(2)(ii)', label: 'Pawn or pledge of movable property, loan above ₹10 lakh', rule: { type: 'percent', rate: 0.5, base: 'Loan amount', baseMin: 1000001 } },
    { code: '34(d)(i)', label: 'Mortgage deed, hypothecation of movable property, loan up to ₹10 lakh', rule: { type: 'per', every: 10000, amount: 50, base: 'Loan amount', baseMax: 1000000 } },
    { code: '34(d)(ii)', label: 'Mortgage deed, loan above ₹10 lakh', rule: { type: 'per', every: 10000, amount: 50, base: 'Loan amount', baseMin: 1000001 } },
    { code: '56(ii)', label: 'Bank Guarantee, e-bank guarantee' },
    { code: '7', label: 'Appointment in execution of a power' },
    { code: '12(a)', label: 'Bond, amount secured up to ₹1,000' },
    { code: '12(b)', label: 'Bond, amount secured above ₹1,000' },
  ],
  delhi: [
    { code: '4', label: 'Affidavit' },
    { code: '4', label: 'Declaration', key: '4-declaration' },
    { code: '5', label: 'General Agreement' },
    { code: '35(a)(i)', label: 'Lease, term of less than one year', hint: 'Most rent agreements' },
    { code: '35(a)(ii)', label: 'Lease, term of one to three years' },
    { code: '35(a)(iii)', label: 'Lease, term of more than three years' },
    { code: '1', label: 'Acknowledgement of a debt' },
    { code: '6(2)(a)', label: 'Agreement relating to deposit of title deed' },
    { code: '15', label: 'Indemnity Bond' },
    { code: '40', label: 'Mortgage / Hypothecation' },
    { code: '26', label: 'Customs Bond' },
    { code: '', label: 'Bank Guarantee', key: 'bank-guarantee' },
  ],
  'uttar-pradesh': [
    { code: '4', label: 'Affidavit' },
    { code: '5c', label: 'Agreement or Memorandum of an Agreement' },
    { code: '35(a)(i)', label: 'Lease, term of less than one year', hint: 'Most rent agreements' },
    { code: '35(a)(ii)', label: 'Lease, term of one to three years' },
    { code: '35(a)(iii)', label: 'Lease, term of more than three years' },
    { code: '48', label: 'Power of Attorney' },
    { code: '34', label: 'Indemnity Bond' },
    { code: '6', label: 'Agreement relating to deposit of title deeds, pawn or pledge' },
    { code: '40', label: 'Deed of Hypothecation' },
    { code: '12A', label: 'Bank Guarantee' },
    { code: '26', label: 'Customs Bond' },
  ],
  telangana: [
    { code: '4', label: 'Affidavit' },
    { code: '6', label: 'Agreement or memorandum not otherwise provided for, when susceptible to value' },
    { code: '6C', label: 'Agreement or memorandum, when not susceptible to value' },
    { code: '42', label: 'Power of Attorney, not relating to immovable property' },
    { code: '30', label: 'Indemnity Bond' },
    { code: '48', label: 'Security Bond' },
    { code: '7A', label: 'Agreement relating to deposit of title deeds' },
    { code: '7B', label: 'Agreement relating to pawn, pledge or hypothecation of movable property' },
    { code: '7C', label: 'Deposit of title deeds, pawn, pledge or hypothecation, by a small or micro enterprise' },
    { code: '23', label: 'Customs Bond' },
  ],
}

/** States without a verified article list: plain document types, article confirmed by our team. */
const GENERIC_DOCS = [
  'Rent / Lease Agreement', 'Affidavit', 'General Agreement', 'Indemnity Bond', 'Power of Attorney',
  'Partnership Deed', 'Loan Agreement', 'MOU / Business Agreement', 'Employment / Service Agreement', 'Declaration / Undertaking',
].map(label => ({ code: '', label, key: `g-${label}` }))

const OTHER_DOC = { code: '', label: 'Other document', key: 'other', hint: 'Describe it in the purpose; our team confirms the article' }

const keyOf = a => a.key || `${a.code}-${a.label}`
const articlesFor = slug => {
  const list = STATE_ARTICLES[slug]
  return { verified: !!list, items: [...(list || GENERIC_DOCS), OTHER_DOC] }
}

/** Duty for a rule and base amount → { duty } or { error } or null when the customer enters it. */
function dutyFromRule(rule, base) {
  if (!rule || rule.type === 'text') return null
  if (rule.type === 'fixed') return { duty: rule.amount }
  const b = Number(base)
  if (!b || b <= 0) return { error: `Enter the ${rule.base.toLowerCase()} to work out the duty.` }
  if (rule.baseMin && b < rule.baseMin) return { error: `This article is for amounts above ₹${(rule.baseMin - 1).toLocaleString('en-IN')}. Choose the other option for this amount.` }
  if (rule.baseMax && b > rule.baseMax) return { error: `This article is for amounts up to ₹${rule.baseMax.toLocaleString('en-IN')}. Choose the other option for this amount.` }
  let duty = rule.type === 'percent' ? Math.ceil((b * rule.rate) / 100) : Math.ceil(b / rule.every) * rule.amount
  if (rule.min) duty = Math.max(duty, rule.min)
  if (rule.max) duty = Math.min(duty, rule.max)
  return { duty }
}

function ruleText(rule) {
  if (!rule) return ''
  if (rule.type === 'fixed') return `Fixed duty of ₹${rule.amount.toLocaleString('en-IN')}`
  if (rule.type === 'text') return rule.text
  if (rule.type === 'percent') return `${rule.rate}% of the ${rule.base.toLowerCase()}${rule.min ? `, minimum ₹${rule.min.toLocaleString('en-IN')}` : ''}${rule.max ? `, maximum ₹${rule.max.toLocaleString('en-IN')}` : ''}`
  return `₹${rule.amount} for every ₹${rule.every.toLocaleString('en-IN')} of the ${rule.base.toLowerCase()} or part of it`
}

module.exports = { STATE_ARTICLES, GENERIC_DOCS, OTHER_DOC, keyOf, articlesFor, dutyFromRule, ruleText }