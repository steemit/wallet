import type { ReactNode } from 'react';
import Image from 'next/image';

function AboutSection({
  title,
  imageSrc,
  imageAlt,
  children,
}: {
  title: string;
  imageSrc: string;
  imageAlt: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-12 flex flex-col gap-8 lg:flex-row lg:gap-12">
      <div className="flex-1 space-y-4">
        <h2 className="text-foreground border-l-4 border-primary pl-3 text-xl font-semibold uppercase tracking-wide">
          {title}
        </h2>
        <div className="text-muted-foreground space-y-4 text-base leading-relaxed">{children}</div>
      </div>
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-lg lg:w-[42%]">
        <Image src={imageSrc} alt={imageAlt} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 40vw" />
      </div>
    </section>
  );
}

export function AboutPageContent() {
  return (
    <div className="about-page">
      <header className="mb-10">
        <h1 className="text-foreground text-2xl font-semibold uppercase tracking-wide md:text-3xl">
          Steemit, Inc. Mission, Vision and Values
        </h1>
      </header>

      <AboutSection title="Mission" imageSrc="/images/about/mission.jpg" imageAlt="">
        <p>
          Make great communities <span className="block">with financial inclusion.</span>
        </p>
      </AboutSection>

      <AboutSection title="Vision" imageSrc="/images/about/coin.jpg" imageAlt="">
        <p>
          Our vision is that steemit.com is a vibrant communities web app, expanding the boundaries of
          community coordination and online discussion by incorporating cryptocurrency as incentives. The
          company focuses on sustainability and decentralization by lowering running costs and increasing
          revenues, while increasing stickiness by providing better homepage and community tools, and is
          always demanding a secure and safe, client-side signing experience.
        </p>
      </AboutSection>

      <AboutSection title="Values" imageSrc="/images/about/priorities.jpg" imageAlt="">
        <h3 className="text-foreground text-lg font-semibold">Cryptocurrency adoption</h3>
        <p>
          Cryptocurrency adoption means advancing tools that contribute to the consumers&apos; ability to be
          aware of, use, hold and appreciate cryptocurrency for its benefits, such as sovereign value store
          and peer-to-peer payments.
        </p>
        <h3 className="text-foreground text-lg font-semibold">Sustainability</h3>
        <p>
          Sustainability means building real business from steemit.com by way of advertisements and
          programatically selling cryptocurrency assets that Steemit, Inc. holds. Steemit, Inc., for
          instance, has held lots of STEEM since 2016. The company could have sold all of it over the past
          several years, and instead continues to hold and only sell programmatically, because we value the
          potential of Steem. Advertising is also an important part of our business for aligning steemit.com
          with all its participants, such as bloggers, content consumers, community builders and our
          company&apos;s shareholders, who all benefit from increased stickiness and usage of steemit.com.
          Both of these revenue sources–capital gains from currency sales and advertising revenue–are valuable
          to our sustainability.
        </p>
        <h3 className="text-foreground text-lg font-semibold">Health</h3>
        <p>
          Health means aligning our organization leaders, including employees and contractors, to contribute in
          ways that advance our organization, which means taking care of their well being in return for their
          commitment to our mission, vision and values.
        </p>
        <h3 className="text-foreground text-lg font-semibold">Safety</h3>
        <p>
          Safety means introducing changes slowly and predictably with much testing. We greatly prefer to move
          carefully and not break things, especially when those things are near steemit.com&apos;s wallet
          functionality or when proposing Steem hardforking upgrades, rather than move fast while introducing
          breaking changes.
        </p>
        <h3 className="text-foreground text-lg font-semibold">Security</h3>
        <p>
          Security means providing tools to our users of steemit.com that mitigate risk when it comes to
          cryptocurrency interactions. This principle has led us to preferred use of client-side signing for
          cryptocurrency use on steemit.com, which means all transactions are pushed by the user while
          Steemit, Inc. never has access to, nor sees the user&apos;s private keys; this keeps the risk of
          cryptocurrency manageable for the user because they can be assured they are the only person
          responsible for their private key usage. Security also comes from open-sourcing most of our
          software. By open-sourcing, we&apos;ve found community engagement occurs to help audit and review the
          published tools. Sometimes bugs and pitfalls are discovered this way. Beyond that, we publish our
          open-source software with an MIT license, which means others can build from it freely and can then
          advance the ecosystem in parallel.
        </p>
      </AboutSection>

      <AboutSection title="Priorities" imageSrc="/images/about/talk.jpg" imageAlt="">
        <p>
          We strive to make steemit.com great for communities and financial inclusion. This includes focusing
          on the following:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Lower operating costs for sustainability and decentralization</li>
          <li>Increasing advertisements revenue</li>
          <li>
            Bite-size, visible changes, which includes increasing homepage functionality, such as the
            following:
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                Updates Log
                <ul className="mt-1 list-disc space-y-1 pl-6">
                  <li>
                    Publish our development-recaps and updates-focused content via Update Log
                    <ul className="mt-1 list-disc space-y-1 pl-6">
                      <li>Communication of Steem developments</li>
                      <li>Communication of steemit.com developments</li>
                      <li>Communication of Steemit, Inc. developments</li>
                      <li>Communication of Steem Dapps / Ecosystem developments</li>
                    </ul>
                  </li>
                  <li>Notify media outlets of additions to the Updates Log</li>
                </ul>
              </li>
            </ul>
          </li>
          <li>Implementing Communities functionality</li>
        </ul>
        <p className="pt-4">What do our Mission, Vision and Values mean for our Steem development?</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            We strive to make Steem great for online communities and financial inclusion. This includes
            focusing on the following items:
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                Lowering costs for decentralization
                <ul className="mt-1 list-disc space-y-1 pl-6">
                  <li>Such as with RocksDB enhancements</li>
                  <li>Lower costs of running full (economic) nodes</li>
                  <li>Lower costs of running steemit.com by lowering costs of hive nodes or new social plugins architecture</li>
                </ul>
              </li>
              <li>
                Propose hardforking upgrades for increasing beneficial functionality
                <ul className="mt-1 list-disc space-y-1 pl-6">
                  <li>Tokens (SMTs)</li>
                  <li>Tokens with vote-able emissions</li>
                  <li>Additional token functions</li>
                </ul>
              </li>
              <li>
                Providing support
                <ul className="mt-1 list-disc space-y-1 pl-6">
                  <li>Exchange support</li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
        <p className="pt-4">
          This is our principled focus for achieving success. Anything we haven&apos;t included in here, and
          there are plenty, because opportunities are so bountiful in this space, is not a focus for us. We
          encourage you to contribute and seek opportunities by picking up anything we aren&apos;t covering,
          particularly if it contributes to STEEM and cryptocurrency adoption.
        </p>
      </AboutSection>

      <AboutSection title="Disclaimer" imageSrc="/images/about/mission.jpg" imageAlt="">
        <p>
          Steemit Inc. (The &ldquo;Company&rdquo;), is a private company that helps develop the open-source
          software that powers steemit.com, including steemd. The Company may own various digital assets,
          including, without limitation, quantities of cryptocurrencies such as STEEM. These assets are the
          sole property of the Company. Further, the Company&apos;s mission, vision, goals, statements,
          actions, and core values do not constitute a contract, commitment, obligation, or other duty to any
          person, company or cryptocurrency network user and are subject to change at any time.
        </p>
      </AboutSection>
    </div>
  );
}
