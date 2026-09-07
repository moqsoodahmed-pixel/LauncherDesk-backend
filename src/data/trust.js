/**
 * trust.js — LauncherDesk trust signal data
 *
 * IMPORTANT: Do NOT invent experts, reviews, case studies, or client logos.
 * This file defines the data schema and holds only approved content.
 *
 * To add real data: populate the arrays below with approved information only.
 */

export const EXPERTS = [
  // Add real expert profiles here when approved by management.
  // Required fields: id, name, designation, qualification, experience, expertise[], services[], bio, photo, linkedin, memberships[], verified
]

export const REVIEWS = [
  // Add only verified Google Business reviews or written testimonials with source URLs.
  // Required fields: id, name, company, city, rating, text, date, source, sourceUrl, verified
]

export const CASE_STUDIES = [
  // Add real or approved-anonymised client stories only.
  // Required fields: id, title, client, industry, location, challenge, services[], timeline, outcome, quote, anonymous
]

export const CLIENT_LOGOS = [
  // Add only where logo usage permission has been obtained.
  // Required fields: id, name, logo, url, permission
]

export const FEATURED_PARTNERS = [
  {
    id:       'doqfy',
    name:     'Doqfy',
    tagline:  'India-ready contract platform — our collab partner',
    category: 'CLM',
    url:      'https://www.doqfy.com/',
    logo:     '/doqfy-logo.png',
    badge:    'Partner',
  },
]
