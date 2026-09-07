/**
 * company.js — LauncherDesk centralized company data (single source of truth)
 * Update here and it propagates everywhere automatically.
 * Set null for any value not yet verified/approved. Do NOT invent statistics.
 */

export const COMPANY = {
  name:         'LauncherDesk',
  legalName:    'DutyLaunch Solutions Private Limited',
  cin:          'U62099KA2025PTC211509',
  tagline:      'Your Business HQ',
  subTagline:   'Launch. Manage. Grow.',
  proposition:  'One platform. One point of contact. Everything your business needs.',
  description:  'LauncherDesk helps founders and businesses access, coordinate and manage the services they need — from registration and compliance to technology, finance, marketing and growth.',
  founded:      '2025',
  url:          'https://www.launcherdesk.com',
  phone:        '+91 85488 54859',
  whatsapp:     '918548854859',
  email:        'contact@launcherdesk.com',
  supportEmail: 'support@launcherdesk.com',
  address: {
    street:  '472/7, 20th L Cross Rd, 4th Block, Koramangala',
    city:    'Bengaluru',
    state:   'Karnataka',
    pincode: '560095',
    country: 'India',
  },
  social: {
    instagram: 'https://www.instagram.com/launcherdesk?igsh=MWxleG1ubm9kNW4xbw==',
    twitter:   'https://x.com/LauncherDesk',
    facebook:  'https://www.facebook.com/share/181iGTzpPf/',
    linkedin:  null,
  },
}

/**
 * COMPANY_METRICS — only populate values that are factually accurate and approved.
 * null = not yet verified. DO NOT fabricate these numbers.
 */
export const COMPANY_METRICS = {
  businessesLaunched: null,
  clientsServed:      null,
  servicesDelivered:  null,
  serviceCategories:  15,    // Verified: 15+ service categories offered
  yearsOperating:     null,
  citiesServed:       null,
  statesServed:       null,
  satisfactionRate:   null,
  expertsOnNetwork:   null,
}

export const HERO_STATS = [
  { id: 'categories', label: 'Service Categories',    value: '15+',  sub: 'Across Launch, Manage & Grow' },
  { id: 'contact',    label: 'Single Point of Contact',value: '1',   sub: 'For everything your business needs' },
  { id: 'coverage',   label: 'Pan-India Coverage',     value: '🇮🇳',  sub: 'Serving businesses across India' },
  { id: 'lifecycle',  label: 'Full Business Lifecycle', value: '360°', sub: 'From setup through growth' },
]

export const TRUST_BADGES = [
  { id: 'msme',  label: 'MSME Registered', verified: true },
  { id: 'india', label: 'Made in India',   verified: true },
]
