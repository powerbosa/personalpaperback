import {
    BadgeColor,
    ContentRating,
    SourceInfo,
    SourceIntents,
} from '@paperback/types'

/**
 * A self-contained source used only to validate the build pipeline.
 *
 * It makes no network requests and scrapes nothing: every method returns
 * static data defined in this file. Its only job is to prove that bundling,
 * icon copying, SourceInfo extraction and manifest generation all work, so
 * that a failure in `npm run bundle:demo` points at the toolchain rather than
 * at a real source.
 *
 * It is not part of the production repository. See scripts/bundle-demo.mjs.
 */
export const ExampleInfo: SourceInfo = {
    version: '1.0.0',
    name: 'Example',
    icon: 'icon.png',
    author: 'powerbosa',
    authorWebsite: 'https://github.com/powerbosa',
    description: 'Pipeline validation source. Returns static local data and makes no network requests.',
    contentRating: ContentRating.EVERYONE,
    websiteBaseURL: 'https://example.com',
    sourceTags: [
        { text: 'Demo', type: BadgeColor.GREY },
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS,
}

const DEMO_ID = 'demo-title-1'

export class Example {
    // The 0.8 toolchain injects the request manager; the demo never uses it.
    requestManager = App.createRequestManager({
        requestsPerSecond: 1,
        requestTimeout: 10_000,
    })

    getMangaShareUrl(mangaId: string): string {
        return `${ExampleInfo.websiteBaseURL}/title/${mangaId}`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles: ['Example Title'],
                image: `${ExampleInfo.websiteBaseURL}/cover.png`,
                status: 'Ongoing',
                author: 'Example Author',
                artist: 'Example Artist',
                desc: 'A placeholder entry used to verify that this repository builds and installs correctly.',
                hentai: false,
            }),
        })
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        return [
            App.createChapter({
                id: 'chapter-1',
                chapNum: 1,
                name: 'Example Chapter',
                langCode: 'en',
            }),
        ]
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: [],
        })
    }

    async getSearchResults(
        query: SearchRequest,
        metadata: unknown,
    ): Promise<PagedResults> {
        return App.createPagedResults({
            results: [
                App.createPartialSourceManga({
                    mangaId: DEMO_ID,
                    title: 'Example Title',
                    image: `${ExampleInfo.websiteBaseURL}/cover.png`,
                }),
            ],
        })
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const section = App.createHomeSection({
            id: 'demo',
            title: 'Example Section',
            containsMoreItems: false,
            type: HomeSectionType.singleRowNormal,
        })

        section.items = [
            App.createPartialSourceManga({
                mangaId: DEMO_ID,
                title: 'Example Title',
                image: `${ExampleInfo.websiteBaseURL}/cover.png`,
            }),
        ]

        sectionCallback(section)
    }
}
