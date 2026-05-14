import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Sonic'
const APP_URL = 'https://sonicinvoices.com'

interface Props {
  highCount?: number
  totalAlerts?: number
  collectionCount?: number
}

const SeoHealthSummary = ({ highCount = 0, totalAlerts = 0, collectionCount = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{highCount} high-severity SEO alert{highCount === 1 ? '' : 's'} detected</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>SEO health weekly summary</Heading>
        <Text style={text}>
          The weekly scan checked <strong>{collectionCount}</strong> published collection{collectionCount === 1 ? '' : 's'} and
          found <strong>{totalAlerts}</strong> issue{totalAlerts === 1 ? '' : 's'} —
          including <strong>{highCount}</strong> marked high severity.
        </Text>
        <Text style={text}>
          High-severity issues usually mean a collection went thin (sold out), the body copy was edited
          in Shopify and no longer matches what {SITE_NAME} wrote, or the SEO completeness score dropped sharply.
        </Text>
        <Section style={{ textAlign: 'center', margin: '32px 0' }}>
          <Button href={`${APP_URL}/rank?alert=high`} style={button}>Review issues</Button>
        </Section>
        <Text style={footer}>{SITE_NAME} · weekly scan</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SeoHealthSummary,
  subject: (d: Record<string, any>) =>
    `${d.highCount ?? 0} high-severity SEO issue${(d.highCount ?? 0) === 1 ? '' : 's'} this week`,
  displayName: 'SEO health weekly summary',
  previewData: { highCount: 3, totalAlerts: 12, collectionCount: 47 },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0b0f17', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 16px' }
const button = {
  backgroundColor: '#0b0f17', color: '#fff', padding: '12px 22px',
  borderRadius: '8px', fontSize: '14px', textDecoration: 'none', fontWeight: 600,
}
const footer = { fontSize: '12px', color: '#94a3b8', margin: '32px 0 0', textAlign: 'center' as const }
