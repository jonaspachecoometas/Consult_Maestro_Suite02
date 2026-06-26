# Design Guidelines: Arcádia Consulting Diagnostic Platform

## Design Approach
**Design System**: Linear + Jira hybrid - Clean, professional productivity interface optimized for complex consulting workflows and data visualization. Focus on clarity, efficient navigation, and information density without overwhelming users.

**Key Design Principles**:
- Clarity over decoration: Every element serves diagnostic/operational purpose
- Information hierarchy: Critical project data immediately accessible
- Role-based progressive disclosure: Show relevant tools per user level
- Professional consulting aesthetic: Trustworthy, systematic, precise

## Typography System

**Font Families** (Google Fonts via CDN):
- Primary: Inter (400, 500, 600, 700) - UI, body text, forms
- Accent: Poppins (600, 700) - Section headers, emphasis

**Type Scale**:
- H1: 2.5rem/700 - Page titles, main dashboard headers
- H2: 1.875rem/600 - Section headers, module titles
- H3: 1.5rem/600 - Card headers, canvas block titles
- H4: 1.25rem/600 - Subsection headers
- Body: 0.9375rem/400 - Standard text, forms
- Small: 0.875rem/400 - Metadata, secondary info
- Tiny: 0.8125rem/500 - Labels, badges, status indicators

## Layout System

**Spacing Primitives** (Tailwind units): 2, 3, 4, 6, 8, 12, 16
- Micro spacing (form fields, icons): 2, 3
- Component internal: 4, 6
- Component separation: 8, 12
- Section padding: 12, 16

**Grid Structure**:
- Sidebar navigation: 280px fixed (collapsible to 72px icon-only)
- Main content: flex-1 with max-w-7xl container
- Two-column layouts: 60/40 split (form/preview, canvas/details)
- Three-column dashboard: grid-cols-3 for metrics cards

## Core Components

### Navigation & Layout
**Top Bar** (h-16, fixed):
- Logo/brand (left), breadcrumbs (center), user profile + notifications (right)
- Search bar (max-w-md) with keyboard shortcut hint
- Quick actions dropdown per user level

**Sidebar Navigation**:
- Hierarchical menu with nested project/client structure
- Active state: subtle left border (4px) + background treatment
- Expandable sections with smooth transitions
- Icons from Heroicons (outline style)

**Project/Client Cards**:
- Compact list view: Avatar/icon, title, metadata, status badge, last updated
- Expanded view: Full canvas preview + quick stats
- Hover state: subtle elevation, reveal action buttons

### Dashboard Components
**Metrics Cards** (grid-cols-1 md:grid-cols-3):
- Icon + label + primary number + trend indicator
- Quick filters: All Projects, Active, Review, Completed
- Per-role visibility (admins see all, managers see team, technicians see assigned)

**Kanban Board** (Jira-style):
- Horizontal scrolling columns: Backlog, Em Diagnóstico, Em Andamento, Revisão, Concluído
- Drag-and-drop project cards with client avatar, title, assignee, due date
- Column headers with count badges
- Add new card button per column

**Canvas Visualizer**:
- 3x3 grid layout for 9 BMC blocks
- Each block: collapsible panel with title, description, bullet points
- Visual indicator for completeness (empty/partial/complete)
- Side-by-side comparison mode: Canvas Real vs Canvas Sistêmico

### Forms & Data Entry
**Input Fields**:
- Labels: text-sm font-medium above field
- Inputs: h-10, rounded-md, border focus states
- Helper text: text-xs below field
- Required fields: red asterisk, clear error states
- Rich text editors (TipTap/Quill) for diagnostic notes

**Multi-step Forms** (New Project/Client):
- Progress stepper at top showing 4-5 stages
- Single column form layout (max-w-2xl)
- Action buttons: Cancel (ghost), Back (outline), Next/Save (solid)

**Diagnostic Modules**:
- Tabbed interface for Canvas blocks (sticky tabs)
- Expandable sections per deliverable type
- File upload zones for supporting documents
- Auto-save indicators

### Data Display
**Tables**:
- Zebra striping for readability
- Sortable columns with icon indicators
- Inline actions on hover (edit, delete, view)
- Pagination with items per page selector

**Status Badges**:
- Rounded-full, text-xs font-medium, px-3 py-1
- Semantic states: Active, Review, Blocked, Complete, Archived

**User Avatars**:
- Rounded-full with initials fallback
- Size variants: xs (24px), sm (32px), md (40px), lg (48px)
- Stacked avatars for team assignments (max 3 + counter)

### Modals & Overlays
**Modal Pattern**:
- Centered overlay with backdrop blur
- Max-width constraints: sm (28rem), md (32rem), lg (42rem)
- Header with title + close button
- Scrollable content area
- Sticky footer with actions

**Dropdown Menus**:
- Right-aligned from trigger
- Dividers between logical groups
- Icons for visual scanning
- Keyboard navigation support

## Animations
**Minimal, Purposeful Motion**:
- Page transitions: none (instant)
- Dropdown/modal: 150ms ease-out
- Hover elevations: 200ms ease
- Drag-and-drop: follow cursor smoothly
- Loading states: subtle spinner, no page-blocking

## Images
**Strategic Image Use**:
- User avatars throughout (generated initials if no photo)
- Client logos in project cards and headers
- Empty states: Simple illustrations (undraw.co style) with actionable CTAs
- No hero images - this is a productivity tool, not marketing
- Process diagrams: User-uploaded or generated visual maps

## Accessibility
- Consistent keyboard shortcuts (documented in help modal)
- ARIA labels on all interactive elements
- Focus indicators on all focusable elements
- Color contrast minimum WCAG AA
- Screen reader friendly status announcements

## Responsive Behavior
- Desktop-first (primary use case: consultants at desks)
- Tablet: Sidebar collapses to icons, single column forms
- Mobile: Bottom navigation, stacked cards, simplified tables

This design creates a professional, efficient consulting platform that balances complex data visualization with clean usability - perfect for operationalizing the Arcádia methodology.