/**
 * Top-level tool navigation. Sits between the page header and the main
 * content on every view (calculator + details) and acts as the single
 * place from which the user picks which tool to use.
 *
 * The bar exposes one button per category (Transmission Line so far);
 * clicking a category opens a dropdown menu of tools inside it. Tools
 * marked `available: false` are shown with a "Coming soon" badge and
 * are not clickable — they signal what's planned without surfacing
 * dead links.
 *
 * Behaviours of the dropdown:
 *   - Click the category button to open / close.
 *   - Click anywhere outside the nav to close.
 *   - Esc closes the open menu and refocuses the trigger.
 *   - aria-haspopup / aria-expanded / role="menu" + role="menuitem" so
 *     screen readers can announce the dropdown shape.
 *
 * The component is purely presentational + emits `onSelectTool(id)` when
 * the user picks an available tool. App.tsx maps that callback to its
 * top-level view state — e.g. picking `microstrip` from the details
 * page lands the user back in the calculator. Extending to a second
 * tool category later means adding one entry to the local `CATEGORIES`
 * constant and one i18n key per label; no other wiring needed.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolItem {
  /** Stable id used by `onSelectTool`. */
  id: string;
  /** i18next key for the visible label. */
  labelKey: string;
  /** false → rendered as a disabled "Coming soon" entry. */
  available: boolean;
}

interface ToolCategory {
  id: string;
  labelKey: string;
  items: ToolItem[];
}

/** Single source of truth for the menu structure. Extend this when new
 *  tools land — every other piece of plumbing keys off `id` strings. */
const CATEGORIES: ToolCategory[] = [
  {
    id: 'transmission-line',
    labelKey: 'nav.categories.transmissionLine',
    items: [
      { id: 'microstrip', labelKey: 'nav.tools.microstrip', available: true },
      { id: 'stripline', labelKey: 'nav.tools.stripline', available: false },
      { id: 'cpw', labelKey: 'nav.tools.cpw', available: false },
      {
        id: 'differential-pair',
        labelKey: 'nav.tools.differentialPair',
        available: false,
      },
    ],
  },
];

export interface ToolNavProps {
  /** id of the tool currently in focus — used both for highlighting
   *  the right tab and for marking the right dropdown row active. */
  activeToolId: string;
  /** Fired when the user clicks an available tool. The same tool that
   *  is already active fires too: the parent decides whether to act
   *  (e.g. always navigate "back" to that tool's view). */
  onSelectTool: (toolId: string) => void;
}

export function ToolNav({ activeToolId, onSelectTool }: ToolNavProps): React.ReactElement {
  const { t } = useTranslation();
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  /** Refs to the category trigger buttons so Esc can hand focus back
   *  to the trigger after closing the dropdown. */
  const triggerRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  // Outside click closes the menu.
  useEffect(() => {
    if (openCategoryId === null) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenCategoryId(null);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [openCategoryId]);

  // Esc closes the menu and returns focus to the originating trigger.
  useEffect(() => {
    if (openCategoryId === null) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const trigger = triggerRefs.current.get(openCategoryId);
        setOpenCategoryId(null);
        trigger?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openCategoryId]);

  return (
    <nav className="tool-nav" ref={navRef} aria-label={t('nav.label')}>
      <ul className="tool-nav__tabs">
        {CATEGORIES.map((cat) => {
          const isOpen = openCategoryId === cat.id;
          const hasActiveTool = cat.items.some(
            (item) => item.id === activeToolId && item.available,
          );
          return (
            <li key={cat.id} className="tool-nav__tab-item">
              <button
                type="button"
                ref={(node) => {
                  triggerRefs.current.set(cat.id, node);
                }}
                className={
                  hasActiveTool
                    ? 'tool-nav__tab tool-nav__tab--active'
                    : 'tool-nav__tab'
                }
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setOpenCategoryId(isOpen ? null : cat.id)}
              >
                <span>{t(cat.labelKey)}</span>
                <span className="tool-nav__chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {isOpen && (
                <ul className="tool-nav__menu" role="menu">
                  {cat.items.map((item) => {
                    const isActive = item.id === activeToolId;
                    const classes = ['tool-nav__menu-item'];
                    if (isActive) classes.push('tool-nav__menu-item--active');
                    if (!item.available) classes.push('tool-nav__menu-item--disabled');
                    return (
                      <li key={item.id} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          className={classes.join(' ')}
                          disabled={!item.available}
                          onClick={() => {
                            if (!item.available) return;
                            onSelectTool(item.id);
                            setOpenCategoryId(null);
                          }}
                        >
                          <span className="tool-nav__menu-item-label">
                            {t(item.labelKey)}
                          </span>
                          {!item.available && (
                            <span className="tool-nav__badge">
                              {t('nav.comingSoon')}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
