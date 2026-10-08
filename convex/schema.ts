import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { formDefaultsValidator, letterBlockValidator, letterSettingsValidator, letterValidator, selectionValidator } from './lib/application'
import { cvValidator } from './lib/cv'

export default defineSchema({
  jobs: defineTable({
    sourceKey: v.string(),
    externalId: v.string(),
    company: v.string(),
    title: v.string(),
    service: v.string(),
    businessArea: v.string(),
    contractType: v.string(),
    location: v.string(),
    url: v.string(),
    // Legacy: descriptions now live in jobDetails so the radar can read every
    // active offer without crossing Convex's 16 MB read limit.
    description: v.optional(v.string()),
    requiredExperienceYears: v.optional(v.number()),
    skills: v.array(v.string()),
    categories: v.array(v.string()),
    techScore: v.number(),
    marketScore: v.number(),
    fitScore: v.number(),
    totalScore: v.number(),
    priority: v.string(),
    relevant: v.boolean(),
    active: v.boolean(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_source_external', ['sourceKey', 'externalId'])
    .index('by_active_score', ['active', 'totalScore'])
    .index('by_last_seen', ['lastSeenAt']),
  jobDetails: defineTable({
    jobId: v.id('jobs'),
    description: v.string(),
    updatedAt: v.number(),
  }).index('by_job', ['jobId']),
  crawlRuns: defineTable({
    sourceKey: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.string(),
    discovered: v.number(),
    relevant: v.number(),
    error: v.optional(v.string()),
  })
    .index('by_started_at', ['startedAt'])
    .index('by_source_started', ['sourceKey', 'startedAt']),
  radarSettings: defineTable({
    key: v.string(),
    frequency: v.string(),
    weekday: v.number(),
    hour: v.number(),
    recipient: v.string(),
    profiles: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          email: v.string(),
          emails: v.optional(v.array(v.string())),
          enabled: v.boolean(),
          frequency: v.string(),
          weekday: v.number(),
          hour: v.number(),
          contractTypes: v.array(v.string()),
          targetKeywords: v.array(v.string()),
          excludedKeywords: v.optional(v.array(v.string())),
          techRoles: v.optional(v.string()),
          marketFocus: v.optional(v.string()),
          // The person who applies with this profile (one of `emails`).
          ownerEmail: v.optional(v.string()),
          maxExperienceYears: v.optional(v.number()),
          companyFilterMode: v.optional(v.string()),
          companies: v.optional(v.array(v.string())),
          weights: v.object({ tech: v.number(), market: v.number(), fit: v.number() }),
          lastScheduleKey: v.optional(v.string()),
          lastReportAt: v.optional(v.number()),
        }),
      ),
    ),
    lastScheduleKey: v.optional(v.string()),
    lastReportAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
  // One person = one email = one master CV.
  candidates: defineTable({
    email: v.string(),
    cv: v.optional(cvValidator),
    rawText: v.optional(v.string()),
    file: v.optional(
      v.object({ storageId: v.id('_storage'), name: v.string(), size: v.number(), uploadedAt: v.number() }),
    ),
    // empty | extracting | review | ready | error
    status: v.string(),
    error: v.optional(v.string()),
    extractionStartedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    // Letter library: human-validated paragraphs the model picks from.
    letterBlocks: v.optional(v.array(letterBlockValidator)),
    letterSettings: v.optional(letterSettingsValidator),
    // Answers portals often ask, filled by the extension.
    formDefaults: v.optional(formDefaultsValidator),
    updatedAt: v.number(),
  })
    .index('by_email', ['email'])
    .index('by_status', ['status']),
  // One tailored application per offer: selection, letter, PDFs.
  applications: defineTable({
    // Optional: applications added by hand (done outside the app) have no job.
    jobId: v.optional(v.id('jobs')),
    manualUrl: v.optional(v.string()),
    profileId: v.string(),
    candidateEmail: v.string(),
    jobTitle: v.string(),
    company: v.string(),
    // queued | generating | rendering | ready | error | validated
    // | sending | sending-busy | sent | archived
    status: v.string(),
    selection: v.optional(selectionValidator),
    hook: v.optional(v.string()),
    hookSource: v.optional(v.string()),
    letter: v.optional(letterValidator),
    cvFile: v.optional(v.id('_storage')),
    letterFile: v.optional(v.id('_storage')),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    validatedAt: v.optional(v.number()),
    // Email sending (only after validation + explicit confirmation).
    recipient: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailBody: v.optional(v.string()),
    sendRequestedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    sentFrom: v.optional(v.string()),
    // "email" or "portail" (submitted on the company's site, detected by the extension)
    sentVia: v.optional(v.string()),
    messageId: v.optional(v.string()),
    sendError: v.optional(v.string()),
    // Follow-up after sending: envoyee | accuse | test | entretien | offre | refus | abandon
    outcome: v.optional(v.string()),
    outcomeAt: v.optional(v.number()),
    followUpAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    events: v.optional(
      v.array(
        v.object({
          at: v.number(),
          type: v.string(),
          source: v.string(),
          subject: v.optional(v.string()),
          from: v.optional(v.string()),
          snippet: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status'])
    .index('by_job', ['jobId'])
    .index('by_updated', ['updatedAt']),
  // Inbox watcher state (read-only IMAP) and the emails it linked.
  mailState: defineTable({
    key: v.string(),
    lastUid: v.optional(v.number()),
    uidValidity: v.optional(v.number()),
    lastCheckAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    scanned: v.optional(v.number()),
  }).index('by_key', ['key']),
  mailMatches: defineTable({
    messageId: v.string(),
    applicationId: v.optional(v.id('applications')),
    receivedAt: v.number(),
    from: v.string(),
    subject: v.string(),
    snippet: v.string(),
    category: v.string(),
    applied: v.boolean(),
  })
    .index('by_message', ['messageId'])
    .index('by_received', ['receivedAt']),
  migrations: defineTable({
    name: v.string(),
    status: v.string(),
    processed: v.number(),
    cursor: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index('by_name', ['name']),
  workflows: defineTable({
    key: v.string(),
    name: v.string(),
    nodes: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        description: v.string(),
        kind: v.string(),
        status: v.string(),
        mode: v.string(),
        x: v.number(),
        y: v.number(),
      }),
    ),
    edges: v.array(
      v.object({
        id: v.string(),
        from: v.string(),
        to: v.string(),
        status: v.string(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
  workflowRuns: defineTable({
    workflowId: v.id('workflows'),
    jobId: v.id('jobs'),
    jobTitle: v.string(),
    status: v.string(),
    currentNodeId: v.optional(v.string()),
    steps: v.array(
      v.object({
        nodeId: v.string(),
        status: v.string(),
        output: v.optional(v.string()),
        updatedAt: v.number(),
      }),
    ),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_workflow_updated', ['workflowId', 'updatedAt'])
    .index('by_status_updated', ['status', 'updatedAt']),
  scanRequests: defineTable({
    status: v.string(),
    requestedAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    totalSources: v.number(),
    completedSources: v.number(),
    currentSource: v.optional(v.string()),
    currentPhase: v.optional(v.string()),
    profileId: v.optional(v.string()),
    profileName: v.optional(v.string()),
    sendReport: v.optional(v.boolean()),
    trigger: v.optional(v.string()),
    error: v.optional(v.string()),
  })
    .index('by_requested', ['requestedAt'])
    .index('by_status_requested', ['status', 'requestedAt']),
  scanEvents: defineTable({
    requestId: v.id('scanRequests'),
    at: v.number(),
    sourceKey: v.optional(v.string()),
    sourceName: v.optional(v.string()),
    status: v.string(),
    message: v.string(),
  }).index('by_request_at', ['requestId', 'at']),
  systemStatus: defineTable({
    key: v.string(),
    workerSeenAt: v.number(),
    ollamaStatus: v.string(),
    ollamaModel: v.optional(v.string()),
    // SMTP sender address (not a secret) so the UI can check who sends.
    mailFrom: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
})
