export {};

const oldUiPlayerBarSelector = '#dragonflyTransport .rightSide';

function setupConnector() {
	if (isNewPlayer()) {
		Util.debugLog('Setup connector for the new player');

		setupPropertiesForNewPlayer();
	} else {
		Util.debugLog('Setup connector for the old player');

		setupPropertiesForOldPlayer();
	}

	Connector.applyFilter(MetadataFilter.createAmazonFilter());
}

function isNewPlayer() {
	return document.querySelector(oldUiPlayerBarSelector) === null;
}

/*
 * The web player has been rebuilt (React Native Web, rolled out Aug-Oct 2026).
 * The bar at the bottom is now a "MiniPlayer" with no stable id or landmark, so
 * it is found through the locale-independent `data-testid`s Amazon ships, and
 * only exists once playback has started. The previous web-components markup
 * (`#transport music-horizontal-item`) is kept as a fallback for regions that
 * have not been migrated yet. Every getter decides at call time which markup is
 * present, because the MiniPlayer appears after this script has run, and none
 * of them depends on the progress slider exposing ARIA values (not every
 * variant does).
 */
const miniPlayerTitleSelector = '[data-testid="MiniPlayer_Title"]';
const miniPlayerImageSelector =
	'[data-testid="ListItemImage,MiniPlayer_Image"] img';
const miniPlayerPauseSelector = '[data-testid="IconButton,MiniPlayer_Pause"]';

const transportSelector = '#transport';
const transportTrackSelector = `${transportSelector} music-horizontal-item`;

/**
 * Smallest ancestor of the MiniPlayer title that also holds the artist link(s).
 * The title, artist(s) and "playing from" link share one small box.
 */
function getMiniPlayerInfoBox(title: Element): Element | null {
	let box: Element | null = title.parentElement;
	for (let depth = 0; box && depth < 5; depth++) {
		if (box.querySelector('a[href^="/artists/"]')) {
			return box;
		}
		box = box.parentElement;
	}
	return null;
}

function getMiniPlayerTrackInfo() {
	const title = document.querySelector(miniPlayerTitleSelector);
	if (title === null) {
		return null;
	}

	const box = getMiniPlayerInfoBox(title);
	const artist = box
		? Util.joinArtists(
				Array.from(box.querySelectorAll('a[href^="/artists/"]')),
			)
		: null;

	// The secondary link is whatever the track is playing from (album,
	// playlist, station...). Only an album link is the track's album.
	const albumLink = box?.querySelector('a[href^="/albums/"]');
	const album = albumLink ? albumLink.textContent : null;

	// The MiniPlayer shows a 128x128 thumbnail; ask for a 500x500 one.
	const trackArt = Util.getAttrFromSelectors(
		miniPlayerImageSelector,
		'src',
	)?.replace(/\._[^./]+_\.(\w+)$/, '._SX500_SY500_.$1');

	return { artist, track: title.textContent, album, trackArt };
}

function getMediaElement(): HTMLMediaElement | null {
	return document.querySelector('audio, video');
}

/**
 * Some MiniPlayer variants expose the position on an ARIA slider, others
 * (e.g. music.amazon.com in Nov 2026) render a bare progress bar. The media
 * element is read first; the slider is a fallback.
 */
function getSliderValue(attribute: string): number | null {
	const value = Util.getAttrFromSelectors(
		'[role="slider"][aria-valuemax]',
		attribute,
	);
	const number = value === null ? NaN : Number.parseFloat(value);
	return Number.isFinite(number) ? number : null;
}

function setupPropertiesForNewPlayer() {
	// The MiniPlayer has no stable container and animates its elements with
	// JS, so observing a container fires dozens of times per second and slows
	// the page down. Poll the player state instead.
	Connector.playerSelector = null;
	setInterval(() => Connector.onStateChanged(), 1000);

	Connector.getTrackInfo = () => {
		const miniPlayerInfo = getMiniPlayerTrackInfo();
		if (miniPlayerInfo !== null) {
			return miniPlayerInfo;
		}

		const trackContainer = document.querySelector(transportTrackSelector);
		if (trackContainer === null) {
			return null;
		}

		const artist = trackContainer.getAttribute('secondary-text');
		const track = trackContainer.getAttribute('primary-text');
		const trackArt = trackContainer.getAttribute('image-src');

		return { artist, track, trackArt };
	};

	Connector.getUniqueID = () => {
		const href = Util.getAttrFromSelectors(miniPlayerTitleSelector, 'href');
		return href?.match(/^\/tracks\/([A-Z0-9]+)/)?.[1] ?? null;
	};

	Connector.getCurrentTime = () => {
		if (document.querySelector(miniPlayerTitleSelector) === null) {
			return null;
		}
		const currentTime = getMediaElement()?.currentTime;
		return currentTime !== undefined && Number.isFinite(currentTime)
			? currentTime
			: getSliderValue('aria-valuenow');
	};

	Connector.getDuration = () => {
		if (document.querySelector(miniPlayerTitleSelector) === null) {
			return null;
		}
		const duration = getMediaElement()?.duration;
		return duration && Number.isFinite(duration)
			? duration
			: getSliderValue('aria-valuemax');
	};

	Connector.scrobblingDisallowedReason = () => {
		const title = document.querySelector(miniPlayerTitleSelector);
		if (title !== null) {
			// Music tracks link to /tracks/<ASIN>; anything else in the
			// MiniPlayer (podcast episodes, ads) is not a scrobble.
			const href = title.getAttribute('href') ?? '';
			return href.startsWith('/tracks/') ? null : 'Other';
		}

		const trackLink = Util.getAttrFromSelectors(
			transportTrackSelector,
			'primary-href',
		);

		// NOTE Regular tracks have no link
		// Check this condition first if the connector does not work
		return trackLink === '#' ? null : 'IsAd';
	};

	Connector.pauseButtonSelector = [
		miniPlayerPauseSelector,
		`${transportSelector} music-button[icon-name=pause]`,
	];
}

function setupPropertiesForOldPlayer() {
	const optionBtnSelector = '.buttonOption.main[title=Options]';

	Connector.playerSelector = oldUiPlayerBarSelector;

	Connector.getArtist = () => {
		// FIXME Use unified selector
		return Util.getAttrFromSelectors(
			[
				'.trackInfoContainer .trackArtist a',
				'.trackInfoContainer .trackArtist span',
			],
			'title',
		);
	};

	Connector.getAlbumArtist = Connector.getArtist;

	Connector.trackSelector = '.trackInfoContainer .trackTitle';

	Connector.getAlbum = () => {
		const sourceLink = document.querySelector('.trackSourceLink a');
		if (sourceLink) {
			const sourceLinkUrl = sourceLink.getAttribute('href');
			if (sourceLinkUrl && sourceLinkUrl.includes('albums')) {
				return sourceLink.textContent;
			}
		}

		const albumCellTitle = Util.getAttrFromSelectors(
			'tr.selectable.currentlyPlaying td.albumCell',
			'title',
		);
		if (albumCellTitle) {
			return albumCellTitle;
		}

		const albumImageTitle = Util.getAttrFromSelectors(
			'.nowPlayingDetail img.albumImage',
			'title',
		);
		if (albumImageTitle) {
			return albumImageTitle;
		}

		if (sourceLink) {
			const clickAction = sourceLink.getAttribute('data-ui-click-action');
			if (clickAction === 'selectAlbum') {
				return sourceLink.getAttribute('title');
			}
		}

		return null;
	};

	Connector.currentTimeSelector = '.songDuration.timeElapsed';

	Connector.playButtonSelector =
		'.rightSide .playbackControls .playerIconPlay';

	Connector.durationSelector = '#currentDuration';

	Connector.trackArtSelector = '.rightSide .albumArtWrapper img';

	Connector.getUniqueID = () => {
		const optionsHref = Util.getAttrFromSelectors(
			optionBtnSelector,
			'href',
		);
		return optionsHref && optionsHref.replace(/[\W\w]+adriveId=/, '');
	};
}

setupConnector();
