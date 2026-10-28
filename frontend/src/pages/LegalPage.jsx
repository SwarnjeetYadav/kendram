import { useEffect } from 'react'
import CookieConsent from '../components/CookieConsent'

const content = {
  privacy: {
    title: 'Privacy Policy',
    description: 'How Kendram handles account, workspace, and preference data.',
    updated: 'October 11, 2026',
    sections: [
      ['Information we handle', 'Kendram may process account details such as your name and email, authentication data, projects, tasks, team membership, comments, and preferences that you or your workspace submit. The app also receives technical request information needed to operate and protect the service.'],
      ['How information is used', 'Information is used to authenticate users, provide project-management and collaboration features, save workspace preferences, troubleshoot reliability issues, and protect the service against misuse.'],
      ['Storage and security', 'Authentication tokens and cached workspace data may be stored in your browser. The service uses HTTPS on its production hosting and server-side access controls. No internet service can promise absolute security; do not submit secrets or sensitive personal information into project content.'],
      ['Cookies and analytics', 'Essential browser storage supports sign-in and application preferences. Optional analytics are disabled until you choose to allow them in the consent banner. If an analytics measurement ID is configured by the operator, analytics load only after consent. You can clear this choice through your browser storage settings.'],
      ['Sharing and service providers', 'Data may be processed by hosting, database, and infrastructure providers needed to run Kendram. The app does not sell personal information. Workspace information may be visible to other users according to project membership and permissions.'],
      ['Retention and your choices', 'Data is retained as needed to provide the service and meet operational or legal requirements. Contact the service operator to request help with account or data questions. Clearing browser storage signs you out and removes local cached preferences, but does not delete server-side account data.'],
      ['Children and policy changes', 'Kendram is a general productivity tool and is not designed to collect information from children. This policy may be updated as the product changes; the date above indicates the latest revision.'],
      ['Contact', 'For privacy questions, contact the Kendram service operator through the project repository or the contact channel provided by your workspace administrator.'],
    ],
  },
  terms: {
    title: 'Terms and Conditions',
    description: 'The basic terms for using the Kendram project workspace.',
    updated: 'October 11, 2026',
    sections: [
      ['Using the service', 'Kendram provides project, task, team, and reporting tools. You agree to use the service lawfully, provide accurate account information, and keep your login credentials secure.'],
      ['Accounts and access', 'You are responsible for activity performed through your account. Access to projects and workspace data depends on your assigned role and membership. Do not attempt to bypass permissions or access another user’s account.'],
      ['Acceptable use', 'Do not use Kendram to distribute unlawful content, abuse other users, interfere with the service, probe systems without authorization, or upload malware, credentials, or information you do not have permission to share.'],
      ['Your content', 'You retain responsibility for the content you submit, including task details, files, comments, and project information. You must have the rights and permissions required to store and share that content with your workspace.'],
      ['Availability and changes', 'The service may be changed, interrupted, or withdrawn for maintenance, security, or operational reasons. Features and data should not be treated as a substitute for independent backups of important information.'],
      ['Disclaimer and liability', 'To the extent permitted by applicable law, the service is provided on an “as is” and “as available” basis without a guarantee of uninterrupted operation or error-free results. Nothing in these terms excludes liability that cannot lawfully be excluded.'],
      ['Suspension and termination', 'Access may be restricted where needed to protect users, investigate abuse, comply with law, or maintain service integrity. You may stop using the service at any time.'],
      ['Changes and contact', 'These terms may be revised as the product evolves. Continued use after a revised version is published means you acknowledge the updated terms where applicable. For questions, contact the service operator through the project repository or your workspace administrator.'],
    ],
  },
}

export default function LegalPage({ type = 'privacy' }) {
  const page = content[type] || content.privacy

  useEffect(() => {
    document.title = page.title + ' | Kendram'
    const description = document.querySelector('meta[name="description"]')
    if (description) description.setAttribute('content', page.description)
    window.scrollTo(0, 0)
  }, [page])

  return (
    <div className="legal-page-shell">
      <header className="legal-topbar">
        <a className="legal-brand" href="/" aria-label="Kendram home"><span className="brand-mark">AN</span><strong>Kendram</strong></a>
        <a className="legal-back-link" href="/">Back to workspace</a>
      </header>
      <main className="legal-content">
        <span className="eyebrow">ANVAYA · POLICIES</span>
        <h1>{page.title}</h1>
        <p className="legal-intro">{page.description}</p>
        <p className="legal-updated">Last updated: {page.updated}</p>
        {page.sections.map(([heading, body]) => (
          <section className="legal-section" key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
        <nav className="legal-footer-links" aria-label="Legal pages">
          <a href="/privacy-policy">Privacy Policy</a><a href="/terms-and-conditions">Terms and Conditions</a>
        </nav>
        <p className="legal-disclaimer">This page is a general product policy template, not legal advice. Have it reviewed for your actual data practices and applicable laws before relying on it as a final legal document.</p>
      </main>
      <CookieConsent />
    </div>
  )
}
