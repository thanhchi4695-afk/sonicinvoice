import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Sonic Invoices'

interface SupportRequestProps {
  customerEmail?: string
  customerName?: string
  message?: string
  screenshotUrl?: string
  pageUrl?: string
  submittedAt?: string
  topic?: string
}

const SupportRequestEmail = ({
  customerEmail,
  customerName,
  message,
  screenshotUrl,
  pageUrl,
  submittedAt,
  topic,
}: SupportRequestProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New support request from {customerEmail || 'a customer'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New support request</Heading>
        <Text style={text}>
          A customer has submitted a support request through {SITE_NAME}.
        </Text>

        <Section style={infoBox}>
          {topic && (
            <Text style={infoRow}>
              <strong>Topic:</strong> {topic}
            </Text>
          )}
          {customerName && (
            <Text style={infoRow}>
              <strong>Name:</strong> {customerName}
            </Text>
          )}
          <Text style={infoRow}>
            <strong>Email:</strong>{' '}
            {customerEmail ? (
              <Link href={`mailto:${customerEmail}`} style={link}>
                {customerEmail}
              </Link>
            ) : (
              'Not provided'
            )}
          </Text>
          {submittedAt && (
            <Text style={infoRow}>
              <strong>Submitted:</strong> {submittedAt}
            </Text>
          )}
          {pageUrl && (
            <Text style={infoRow}>
              <strong>Page:</strong> {pageUrl}
            </Text>
          )}
        </Section>

        <Heading as="h2" style={h2}>
          Message
        </Heading>
        <Text style={messageBox}>{message || '(No message provided)'}</Text>

        {screenshotUrl && (
          <>
            <Heading as="h2" style={h2}>
              Screenshot
            </Heading>
            <Link href={screenshotUrl} style={link}>
              <Img
                src={screenshotUrl}
                alt="Customer screenshot"
                style={screenshot}
              />
            </Link>
            <Text style={smallText}>
              <Link href={screenshotUrl} style={link}>
                Open full-size screenshot
              </Link>
            </Text>
          </>
        )}

        <Hr style={hr} />
        <Text style={footer}>
          Reply directly to {customerEmail || 'the customer'} to respond.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SupportRequestEmail,
  subject: (data: Record<string, any>) =>
    data.topic
      ? `[${data.topic}] Support request from ${data.customerEmail || 'a customer'}`
      : `Support request from ${data.customerEmail || 'a customer'}`,
  displayName: 'Support request',
  to: 'thanhchi4695@gmail.com',
  previewData: {
    customerEmail: 'jane@example.com',
    customerName: 'Jane Doe',
    message: 'I cannot find the export button on the invoices page.',
    screenshotUrl: 'https://placehold.co/600x400',
    pageUrl: 'https://sonicinvoices.com/dashboard',
    submittedAt: new Date().toISOString(),
    topic: 'Invoice processing',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
}
const container = { padding: '24px', maxWidth: '600px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#0f172a',
  margin: '0 0 16px',
}
const h2 = {
  fontSize: '15px',
  fontWeight: 'bold',
  color: '#0f172a',
  margin: '24px 0 8px',
}
const text = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.5',
  margin: '0 0 16px',
}
const infoBox = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '16px 0',
}
const infoRow = {
  fontSize: '13px',
  color: '#334155',
  margin: '4px 0',
  lineHeight: '1.5',
}
const messageBox = {
  fontSize: '14px',
  color: '#0f172a',
  lineHeight: '1.6',
  whiteSpace: 'pre-wrap' as const,
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '0 0 16px',
}
const screenshot = {
  maxWidth: '100%',
  height: 'auto',
  borderRadius: '8px',
  border: '1px solid #e2e8f0',
  margin: '8px 0',
}
const link = { color: '#0d9488', textDecoration: 'underline' }
const smallText = { fontSize: '12px', color: '#64748b', margin: '4px 0 0' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '0' }
