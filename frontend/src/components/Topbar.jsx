import Avatar from './Avatar'
import Icon from './Icon'
import { useState } from 'react'
import CommandPalette from './CommandPalette'
import { currentUser } from '../data/teamflowMock'

function displayRole(role = '') {
  return role
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}


export default function Topbar({ page, onOpenMenu, onLogout, onExitDemo, demoMode, notifications = [], onMarkRead, user: propUser, onNavigate, onSelectTask }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const user = propUser || (demoMode ? currentUser : JSON.parse(localStorage.getItem('teamflow_user') || 'null') || currentUser)
  const unreadCount = notifications.filter((item) => item.unread).length

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button mobile-menu" type="button" onClick={onOpenMenu} aria-label="Open navigation"><Icon name="menu" size={20} /></button>
        <div className="breadcrumb"><span>{demoMode ? 'Product Team' : 'My Workspace'}</span><span className="breadcrumb-sep">/</span><strong>{page}</strong></div>
        {demoMode ? <button className="exit-demo-button" type="button" onClick={onExitDemo}>Exit demo · Back to sign in</button> : null}
      </div>

      <div className="topbar-actions">
        <CommandPalette onNavigate={onNavigate} onSelectTask={onSelectTask} />

        <div className="notification-wrap">
          <button className="icon-button notification-button" type="button" onClick={() => setNotificationOpen((value) => !value)} aria-label="Notifications" aria-expanded={notificationOpen}>
            <Icon name="bell" size={18} />
            {unreadCount ? <span className="notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
          </button>

          {notificationOpen ? (
            <div className="notification-popover">
              <div className="notification-head"><strong>Notifications</strong><span>{unreadCount ? unreadCount + ' unread' : 'All caught up'}</span></div>
              <div className="notification-list">
                {notifications.length ? notifications.slice(0, 6).map((item) => (
                  <button type="button" className={'notification-item ' + (item.unread ? 'notification-item-unread' : '')} key={item._id} onClick={() => item.unread && onMarkRead?.(item._id)}>
                    <span className="notification-mark"><Icon name="bell" size={14} /></span>
                    <span><strong>{item.type === 'TASK_ASSIGNED' ? 'Task assigned' : 'Anvaya update'}</strong><small>{item.message}</small><em>{new Date(item.createdAt).toLocaleString('en-IN')}</em></span>
                  </button>
                )) : <div className="notification-empty">No notifications yet.</div>}
              </div>
            </div>
          ) : null}
        </div>

        <div className="profile-menu">
          <button className="user-chip" type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
            {user.avatarUrl ? <img className="topbar-profile-photo" src={user.avatarUrl} alt="" /> : <Avatar initials={user.initials || (user.displayName || user.name)?.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'TF'} color="violet" size="sm" />}
            <span className="user-chip-name">{user.displayName || user.name}</span>
            <span className="chevron">⌄</span>
          </button>
          {menuOpen ? <div className="profile-dropdown"><strong>{displayRole(user.role || 'PROJECT_MANAGER')}</strong>{demoMode ? <span>Demo workspace</span> : <span>Connected to API</span>}<button type="button" onClick={onLogout}>{demoMode ? 'Exit demo & return to login' : 'Sign out'}</button></div> : null}
        </div>
      </div>
    </header>
  )
}
