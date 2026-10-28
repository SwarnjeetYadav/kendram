export const currentUser = {
  name: 'Swarnjeet Yadav',
  initials: 'SY',
  role: 'Project Manager',
}

export const navItems = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Projects', icon: 'folder' },
  { label: 'My Tasks', icon: 'check' },
  { label: 'Team', icon: 'users' },
  { label: 'Reports', icon: 'chart' },
  { label: 'Settings', icon: 'settings' },
]

export const stats = [
  { label: 'Active Projects', value: '08', change: '+2 this month', tone: 'violet', icon: 'folder' },
  { label: 'Open Tasks', value: '42', change: '6 due this week', tone: 'blue', icon: 'check' },
  { label: 'Completed', value: '128', change: '+18 this month', tone: 'green', icon: 'activity' },
  { label: 'Overdue', value: '05', change: '2 need attention', tone: 'rose', icon: 'alert' },
]

export const projects = [
  { name: 'Kendram Web', meta: 'Product · 14 members', progress: 78, tone: 'violet', due: 'Oct 24', tasks: '18 / 23' },
  { name: 'Mobile Experience', meta: 'Product · 7 members', progress: 54, tone: 'blue', due: 'Nov 05', tasks: '11 / 20' },
  { name: 'Marketing Launch', meta: 'Growth · 6 members', progress: 82, tone: 'green', due: 'Oct 18', tasks: '22 / 27' },
]

export const tasks = [
  { id: 'TF-124', title: 'Implement task assignment API', project: 'Kendram Web', assignee: 'AK', assigneeName: 'Ankit Kumar', priority: 'High', status: 'In Progress', due: 'Today' },
  { id: 'TF-121', title: 'Review dashboard wireframes', project: 'Kendram Web', assignee: 'PS', assigneeName: 'Priya Shah', priority: 'Medium', status: 'Review', due: 'Tomorrow' },
  { id: 'MK-084', title: 'Prepare launch content matrix', project: 'Marketing Launch', assignee: 'RM', assigneeName: 'Riya Mehta', priority: 'High', status: 'In Progress', due: 'Oct 12' },
  { id: 'TF-118', title: 'Add notification preferences', project: 'Kendram Web', assignee: 'NS', assigneeName: 'Neha Singh', priority: 'Low', status: 'Todo', due: 'Oct 15' },
  { id: 'MB-031', title: 'Confirm mobile navigation states', project: 'Mobile Experience', assignee: 'VK', assigneeName: 'Vikash Kumar', priority: 'Medium', status: 'Todo', due: 'Oct 16' },
]

export const activity = [
  { initials: 'AK', person: 'Ankit Kumar', action: 'moved TF-124 to In Progress', time: '12 min ago', tone: 'violet' },
  { initials: 'PS', person: 'Priya Shah', action: 'commented on dashboard wireframes', time: '38 min ago', tone: 'blue' },
  { initials: 'RM', person: 'Riya Mehta', action: 'completed MK-081', time: '1 hr ago', tone: 'green' },
  { initials: 'NS', person: 'Neha Singh', action: 'was assigned TF-118', time: '2 hrs ago', tone: 'amber' },
]

export const workload = [
  { initials: 'AK', name: 'Ankit Kumar', tasks: 7, status: 'Balanced', tone: 'green' },
  { initials: 'PS', name: 'Priya Shah', tasks: 5, status: 'Light', tone: 'blue' },
  { initials: 'RM', name: 'Riya Mehta', tasks: 8, status: 'Busy', tone: 'amber' },
  { initials: 'NS', name: 'Neha Singh', tasks: 4, status: 'Light', tone: 'blue' },
]

export const taskMembers = [
  { id: 'ak', name: 'Ankit Kumar', initials: 'AK', activeTasks: 7, tone: 'violet' },
  { id: 'ps', name: 'Priya Shah', initials: 'PS', activeTasks: 5, tone: 'blue' },
  { id: 'rm', name: 'Riya Mehta', initials: 'RM', activeTasks: 8, tone: 'green' },
  { id: 'ns', name: 'Neha Singh', initials: 'NS', activeTasks: 4, tone: 'amber' },
]

export const pageCopy = {
  Projects: ['Portfolio', 'Projects', 'Keep every initiative visible, accountable, and moving forward.'],
  'My Tasks': ['Personal workspace', 'My Tasks', 'See your priorities, deadlines, and work in one focused queue.'],
  Team: ['People', 'Team', 'Understand ownership, workload, and availability at a glance.'],
  Calendar: ['Schedule', 'Calendar', 'Keep upcoming work and deadlines visible alongside your task queue.'],
  Reports: ['Insights', 'Reports', 'Turn project activity into concise, actionable visibility.'],
  Settings: ['Workspace', 'Settings', 'Configure workspace preferences and account controls.'],
}
