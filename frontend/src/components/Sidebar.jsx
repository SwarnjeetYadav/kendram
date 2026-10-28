import Icon from './Icon'
import Avatar from './Avatar'
import { currentUser } from '../data/teamflowMock'

function displayRole(role = '') {
  return role
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}


export default function Sidebar({ page, onNavigate, open, onClose, user, liveData }) {
  const displayUser = user || currentUser

  return (
    <aside className={'sidebar kendram-sidebar ' + (open ? 'sidebar-open' : '')}>
      <div className="sidebar-top kendram-sidebar-top">
        <button className="brand" type="button" onClick={() => onNavigate('Overview')} aria-label="Go to overview">
          <span className="brand-mark kendram-brand-mark" aria-hidden="true"><span /></span>
          <span className="kendram-brand-name">Kendram</span>
        </button>
        <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="Close navigation">
          <Icon name="close" size={19} />
        </button>
      </div>

      <nav className="nav-groups kendram-nav" aria-label="Primary navigation">
        {[
          { label: 'Dashboard', page: 'Overview', icon: 'home' },
          { label: 'My Tasks', page: 'My Tasks', icon: 'check' },
          { label: 'Projects', page: 'Projects', icon: 'folder' },
          { label: 'Team', page: 'Team', icon: 'users' },
          { label: 'Calendar', page: 'Calendar', icon: 'calendar' },
          { label: 'Chat', page: 'Chat', icon: 'chat' },
          { label: 'Reports', page: 'Reports', icon: 'chart' },
          { label: 'Settings', page: 'Settings', icon: 'settings' },
        ].map((item) => {
          const active = item.page === page || (item.page === 'Chat' && page === 'Team')
          return (
            <button key={item.label} type="button" className={'nav-item kendram-nav-item ' + (active ? 'nav-item-active' : '')}
              onClick={() => { onNavigate(item.page === 'Chat' ? 'Team' : item.page); onClose() }}
              aria-current={active ? 'page' : undefined}>
              <span className="nav-icon"><Icon name={item.icon} size={19} /></span>
              <span className="kendram-nav-label">{item.label}</span>
              {item.label === 'Chat' ? <span className="kendram-chat-badge">3</span> : null}
            </button>
          )
        })}
      </nav>

      <div className="kendram-sidebar-footer">
        <Avatar initials={displayUser.initials || displayUser.name?.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'SY'} color="violet" size="lg" />
        <span className="kendram-profile-copy">
          <strong>{displayUser.name || currentUser.name}</strong>
          <small>{displayRole(displayUser.role || currentUser.role)}</small>
        </span>
        <button className="kendram-profile-settings" type="button" onClick={() => { onNavigate('Settings'); onClose() }} aria-label="Open Settings">
          <Icon name="settings" size={17} />
        </button>
      </div>
    </aside>
  )
}
