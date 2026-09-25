import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StockLedgerMark } from '../../components/stockledger-mark';

const contactEmail = import.meta.env.VITE_SUPPORT_EMAIL ?? 'accounts@e9magazine.com';

export function PrivacyPage() {
  return <LegalPage title="Privacy notice">
    <p>StockLedger stores the information needed to run your inventory workspace. This includes account details, business settings, team membership, locations, inventory records, stock movements, and security activity.</p>
    <h2>How we use information</h2>
    <p>We use this information to provide the service, secure accounts, send account emails, investigate errors, and respond to support requests. We do not sell personal information.</p>
    <h2>Service providers</h2>
    <p>Render hosts the application, Supabase provides the PostgreSQL database, and Resend delivers transactional email. If error monitoring is enabled, Sentry receives technical error details. These providers process data only to operate StockLedger.</p>
    <h2>Retention and deletion</h2>
    <p>Workspace owners can export business records and permanently delete a workspace from Settings. Deletion removes the workspace data from the active database. Infrastructure providers may retain encrypted backups for a limited period under their own retention schedules.</p>
    <h2>Your choices</h2>
    <p>You can update profile and business details in the application. For privacy questions or requests that cannot be completed in the app, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
  </LegalPage>;
}

export function TermsPage() {
  return <LegalPage title="Terms of use">
    <p>StockLedger is inventory software for recording items, locations, stock movements, sales, and team access. During the pilot, product behavior and availability may change as we fix issues and learn from participating businesses.</p>
    <h2>Your account</h2>
    <p>You are responsible for accurate account information, keeping sign-in details private, and deciding which team members can access your workspace. Do not use StockLedger for unlawful activity or to interfere with the service.</p>
    <h2>Your data</h2>
    <p>You keep ownership of the business data you enter. You give StockLedger permission to process that data only as needed to provide, secure, and support the service.</p>
    <h2>Inventory decisions</h2>
    <p>StockLedger reports reflect the records entered by you and your team. Check important balances and financial decisions against source documents. The service is not a substitute for professional accounting, tax, or legal advice.</p>
    <h2>Availability and termination</h2>
    <p>We may suspend access to protect the service or other users. You may stop using StockLedger at any time and delete your workspace from Settings. Pilot access is provided without a guaranteed service level.</p>
    <h2>Contact</h2>
    <p>Questions about these terms can be sent to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
  </LegalPage>;
}

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="legal-page">
    <header className="legal-header"><Link className="landing-brand" to="/"><span className="brand-mark"><StockLedgerMark size={24} /></span><span>StockLedger</span></Link><Link to="/"><ArrowLeft size={15} />Back home</Link></header>
    <article className="legal-document"><p className="legal-kicker">StockLedger pilot</p><h1>{title}</h1><time dateTime="2026-09-25">Effective 25 September 2026</time>{children}</article>
  </main>;
}
