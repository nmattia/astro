import type { DevToolbarApp, DevToolbarMetadata } from '../../../../../@types/astro.js';
import type { DevToolbarHighlight } from '../../ui-library/highlight.js';
import {
	attachTooltipToHighlight,
	createHighlight,
	getElementsPositionInDocument,
	positionHighlight,
} from '../utils/highlight.js';
import { closeOnOutsideClick, createWindowElement } from '../utils/window.js';
import {
	resolveAuditRule,
	rulesCategories,
	type AuditRule,
	type ResolvedAuditRule,
	getAuditCategory,
} from './rules/index.js';
import { createRoundedBadge } from '../utils/badge.js';
import { escape as escapeHTML } from 'html-escaper';
import windowStyle from './window-style.js';
import { DevToolbarAuditListItem } from './ui/audit-list-item.js';

function truncate(val: string, maxLength: number): string {
	return val.length > maxLength ? val.slice(0, maxLength - 1) + '&hellip;' : val;
}

const icon =
	'<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 1 20 16"><path fill="#fff" d="M.6 2A1.1 1.1 0 0 1 1.7.9h16.6a1.1 1.1 0 1 1 0 2.2H1.6A1.1 1.1 0 0 1 .8 2Zm1.1 7.1h6a1.1 1.1 0 0 0 0-2.2h-6a1.1 1.1 0 0 0 0 2.2ZM9.3 13H1.8a1.1 1.1 0 1 0 0 2.2h7.5a1.1 1.1 0 1 0 0-2.2Zm11.3 1.9a1.1 1.1 0 0 1-1.5 0l-1.7-1.7a4.1 4.1 0 1 1 1.6-1.6l1.6 1.7a1.1 1.1 0 0 1 0 1.6Zm-5.3-3.4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z"/></svg>';

type Audit = {
	highlightElement: DevToolbarHighlight;
	auditedElement: HTMLElement;
	rule: AuditRule;
	card: HTMLElement;
};

try {
	customElements.define('astro-dev-toolbar-audit-list-item', DevToolbarAuditListItem);
} catch (e) {}

export default {
	id: 'astro:audit',
	name: 'Audit',
	icon: icon,
	async init(canvas, eventTarget) {
		let audits: Audit[] = [];

		await lint();

		document.addEventListener('astro:after-swap', async () => lint());
		document.addEventListener('astro:page-load', async () => refreshLintPositions);

		closeOnOutsideClick(eventTarget, () => {
			const activeAudits = audits.filter((audit) => audit.card.hasAttribute('active'));

			if (activeAudits.length > 0) {
				activeAudits.forEach((audit) => {
					setCardStatus(audit.card, false);
				});
				return true;
			}

			return false;
		});

		async function lint() {
			audits.forEach(({ highlightElement }) => {
				highlightElement.remove();
			});
			audits = [];
			canvas.getElementById('no-audit')?.remove();
			const selectorCache = new Map<string, NodeListOf<Element>>();

			for (const ruleCategory of rulesCategories) {
				for (const rule of ruleCategory.rules) {
					const elements =
						selectorCache.get(rule.selector) ?? document.querySelectorAll(rule.selector);
					let matches: Element[] = [];
					if (typeof rule.match === 'undefined') {
						matches = Array.from(elements);
					} else {
						for (const element of elements) {
							try {
								if (await rule.match(element)) {
									matches.push(element);
								}
							} catch (e) {
								console.error("Error while running audit's match function", e);
							}
						}
					}
					for (const element of matches) {
						// Don't audit elements that already have an audit on them
						// TODO: This is a naive implementation, it'd be good to show all the audits for an element at the same time.
						if (audits.some((audit) => audit.auditedElement === element)) continue;

						await createAuditProblem(rule, element);
					}
				}
			}

			if (audits.length > 0) {
				eventTarget.dispatchEvent(
					new CustomEvent('toggle-notification', {
						detail: {
							state: true,
						},
					})
				);

				const auditListWindow = createWindowElement(
					`
					<style>
						${windowStyle}
					</style>

					<header>
						<section>
							<h1>Audit</h1>
						</section>

						<section></section>
					</header>
					<hr />`
				);

				const headerFirstSection = auditListWindow.querySelector('header>section:first-child');
				const auditCounts = document.createElement('section');
				auditCounts.id = 'audit-counts';

				const auditListContainer = document.createElement('div');
				auditListContainer.id = 'audit-list';

				const backToListButton = document.createElement('button');
				backToListButton.id = 'back-to-list';
				backToListButton.classList.add('reset-button');
				backToListButton.innerHTML = `
					<astro-dev-toolbar-icon icon="arrow-left"></astro-dev-toolbar-icon>
					Back to list
				`;

				backToListButton.addEventListener('click', () => {
					audits.forEach((audit) => {
						setCardStatus(audit.card, false);
					});
				});

				auditListWindow.appendChild(backToListButton);

				rulesCategories.forEach((category) => {
					// Create the header entry for the category
					// This will show the category icon and the number of audits in that category
					const headerEntryContainer = document.createElement('div');
					const auditCount = audits.filter(
						(audit) => getAuditCategory(audit.rule) === category.code
					).length;

					const categoryIcon = document.createElement('astro-dev-toolbar-icon');
					categoryIcon.icon = category.icon;
					const categoryBadge = createRoundedBadge();
					categoryBadge.textContent = auditCount.toString();
					categoryBadge.prepend(categoryIcon);

					if (auditCount === 0) {
						categoryBadge.badgeStyle = 'green';
					}

					headerEntryContainer.append(categoryBadge);
					auditCounts.append(headerEntryContainer);

					// Create group for each category in the audit list
					const categoryGroup = document.createElement('div');
					const categoryHeader = document.createElement('header');
					categoryHeader.className = 'category-header';
					categoryHeader.innerHTML = `<h2>${category.name}</h2>`;
					const categoryHeaderIcon = document.createElement('astro-dev-toolbar-icon');
					categoryHeaderIcon.icon = category.icon;
					categoryHeader.prepend(categoryHeaderIcon);

					categoryGroup.append(categoryHeader);
					const categoryContentContainer = document.createElement('div');
					categoryContentContainer.classList.add('category-content');

					const categoryAudits = audits.filter(
						(audit) => getAuditCategory(audit.rule) === category.code
					);

					categoryAudits.forEach((audit) => {
						categoryContentContainer.append(audit.card);
					});

					categoryGroup.append(categoryContentContainer);
					auditListContainer.append(categoryGroup);
				});

				headerFirstSection!.append(auditCounts);
				auditListWindow.appendChild(auditListContainer);

				canvas.append(auditListWindow);
			} else {
				eventTarget.dispatchEvent(
					new CustomEvent('toggle-notification', {
						detail: {
							state: false,
						},
					})
				);

				const window = createWindowElement(
					`<style>
						header {
							display: flex;
						}

						h1 {
							display: flex;
							align-items: center;
							gap: 8px;
							font-weight: 600;
							color: #fff;
							margin: 0;
							font-size: 22px;
						}

						astro-dev-toolbar-icon {
							width: 1em;
						   height: 1em;
						   padding: 8px;
							display: block;
							background: green;
							border-radius: 9999px;
						}
					</style>
					<header>
						<h1><astro-dev-toolbar-icon icon="check-circle"></astro-dev-toolbar-icon>No accessibility or performance issues detected.</h1>
					</header>
					<p>
						Nice work! This app scans the page and highlights common accessibility and performance issues for you, like a missing "alt" attribute on an image, or a image not using performant attributes.
					</p>
					`
				);

				canvas.append(window);
			}

			(['scroll', 'resize'] as const).forEach((event) => {
				window.addEventListener(event, refreshLintPositions);
			});
		}

		function refreshLintPositions() {
			const noAuditBlock = canvas.getElementById('no-audit');
			if (noAuditBlock) {
				const devOverlayRect = document
					.querySelector('astro-dev-toolbar')
					?.shadowRoot.querySelector('#dev-toolbar-root')
					?.getBoundingClientRect();

				noAuditBlock.style.top = `${
					(devOverlayRect?.top ?? 0) - (devOverlayRect?.height ?? 0) - 16
				}px`;
			}

			audits.forEach(({ highlightElement, auditedElement }) => {
				const rect = auditedElement.getBoundingClientRect();
				positionHighlight(highlightElement, rect);
			});
		}

		async function createAuditProblem(rule: AuditRule, originalElement: Element) {
			const computedStyle = window.getComputedStyle(originalElement);
			const targetedElement = (originalElement.children[0] as HTMLElement) || originalElement;

			// If the element is hidden, don't do anything
			if (targetedElement.offsetParent === null || computedStyle.display === 'none') {
				return;
			}

			// If the element is an image but not yet loaded, ignore it
			// TODO: We shouldn't ignore this, because it is valid for an image to not be loaded at start (e.g. lazy loading)
			if (originalElement.nodeName === 'IMG' && !(originalElement as HTMLImageElement).complete) {
				return;
			}

			const rect = originalElement.getBoundingClientRect();
			const highlight = createHighlight(rect, 'warning', { 'data-audit-code': rule.code });

			const resolvedAuditRule = resolveAuditRule(rule, originalElement);
			const tooltip = buildAuditTooltip(resolvedAuditRule, originalElement);
			const card = buildAuditCard(resolvedAuditRule, highlight, originalElement);

			// If a highlight is hovered or focused, highlight the corresponding card for it
			(['focus', 'mouseover'] as const).forEach((event) => {
				const attribute = event === 'focus' ? 'active' : 'hovered';
				highlight.addEventListener(event, () => {
					if (event === 'focus') {
						audits.forEach((audit) => {
							setCardStatus(audit.card, false);
						});
						if (!card.isManualFocus) card.scrollIntoView();
						setCardStatus(card, true);
					} else {
						card.toggleAttribute(attribute, true);
					}
				});
			});

			highlight.addEventListener('mouseout', () => {
				card.toggleAttribute('hovered', false);
			});

			// Set the highlight/tooltip as being fixed position the highlighted element
			// is fixed. We do this so that we don't mistakenly take scroll position
			// into account when setting the tooltip/highlight positioning.
			//
			// We only do this once due to how expensive computed styles are to calculate,
			// and are unlikely to change. If that turns out to be wrong, reconsider this.
			const { isFixed } = getElementsPositionInDocument(originalElement);
			if (isFixed) {
				tooltip.style.position = highlight.style.position = 'fixed';
			}

			attachTooltipToHighlight(highlight, tooltip, originalElement);

			canvas.append(highlight);
			audits.push({
				highlightElement: highlight,
				auditedElement: originalElement as HTMLElement,
				rule: rule,
				card: card,
			});
		}

		function buildAuditTooltip(rule: ResolvedAuditRule, element: Element) {
			const tooltip = document.createElement('astro-dev-toolbar-tooltip');
			const { title, message } = rule;

			tooltip.sections = [
				{
					icon: 'warning',
					title: escapeHTML(title),
				},
				{
					content: escapeHTML(message),
				},
			];

			const elementFile = element.getAttribute('data-astro-source-file');
			const elementPosition = element.getAttribute('data-astro-source-loc');

			if (elementFile) {
				const elementFileWithPosition =
					elementFile + (elementPosition ? ':' + elementPosition : '');

				tooltip.sections.push({
					content: elementFileWithPosition.slice(
						(window as DevToolbarMetadata).__astro_dev_toolbar__.root.length - 1 // We want to keep the final slash, so minus one.
					),
					clickDescription: 'Click to go to file',
					async clickAction() {
						// NOTE: The path here has to be absolute and without any errors (no double slashes etc)
						// or Vite will silently fail to open the file. Quite annoying.
						await fetch('/__open-in-editor?file=' + encodeURIComponent(elementFileWithPosition));
					},
				});
			}

			return tooltip;
		}

		function buildAuditCard(
			rule: ResolvedAuditRule,
			highlightElement: HTMLElement,
			auditedElement: Element
		) {
			const card = document.createElement(
				'astro-dev-toolbar-audit-list-item'
			) as DevToolbarAuditListItem;

			card.clickAction = () => {
				if (card.hasAttribute('active')) return;

				audits.forEach((audit) => {
					setCardStatus(audit.card, false);
				});
				highlightElement.scrollIntoView();
				card.isManualFocus = true;
				highlightElement.focus();
				card.isManualFocus = false;
			};

			const selectorTitleContainer = document.createElement('section');
			selectorTitleContainer.classList.add('selector-title-container');
			const selector = document.createElement('span');
			const selectorName = truncate(auditedElement.tagName.toLowerCase(), 8);
			selector.classList.add('audit-selector');
			selector.innerHTML = escapeHTML(selectorName);

			const title = document.createElement('h3');
			title.classList.add('audit-title');
			title.innerText = rule.title;

			selectorTitleContainer.append(selector, title);
			card.append(selectorTitleContainer);

			const extendedInfo = document.createElement('div');
			extendedInfo.classList.add('extended-info');

			const selectorButton = document.createElement('button');
			selectorButton.className = 'audit-selector reset-button';
			selectorButton.innerHTML = `${selectorName} <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 256 256"><path d="M128,136v64a8,8,0,0,1-16,0V155.32L45.66,221.66a8,8,0,0,1-11.32-11.32L100.68,144H56a8,8,0,0,1,0-16h64A8,8,0,0,1,128,136ZM208,32H80A16,16,0,0,0,64,48V96a8,8,0,0,0,16,0V48H208V176H160a8,8,0,0,0,0,16h48a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Z"></path></svg>`;

			selectorButton.addEventListener('click', () => {
				highlightElement.scrollIntoView();
				highlightElement.focus();
			});

			extendedInfo.append(title.cloneNode(true));
			extendedInfo.append(selectorButton);
			extendedInfo.append(document.createElement('hr'));

			const message = document.createElement('p');
			message.classList.add('audit-message');
			message.innerHTML = rule.message;
			extendedInfo.appendChild(message);

			const description = rule.description;
			if (description) {
				const descriptionElement = document.createElement('p');
				descriptionElement.classList.add('audit-description');
				descriptionElement.innerHTML = description;
				extendedInfo.appendChild(descriptionElement);
			}

			card.shadowRoot.appendChild(extendedInfo);

			return card;
		}

		function setCardStatus(card: HTMLElement, status: true | false) {
			const auditListContainer = card.closest('#audit-list');
			if (auditListContainer) {
				auditListContainer.toggleAttribute('data-active', status);
			}
			card.toggleAttribute('active', status);
		}
	},
} satisfies DevToolbarApp;
