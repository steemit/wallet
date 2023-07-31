import React from 'react';
import PropTypes from 'prop-types';
import tt from 'counterpart';
import CloseButton from 'app/components/elements/CloseButton';
import Icon from 'app/components/elements/Icon';
import { Link } from 'react-router';
import { connect } from 'react-redux';
import * as appActions from 'app/redux/AppReducer';

const SidePanel = ({
    alignment,
    visible,
    hideSidePanel,
    username,
    user_preferences,
    setUserPreferences,
}) => {
    if (process.env.BROWSER) {
        visible && document.addEventListener('click', hideSidePanel);
        !visible && document.removeEventListener('click', hideSidePanel);
    }

    const loggedIn =
        username === undefined
            ? 'show-for-small-only'
            : 'SidePanel__hide-signup';

    const handleLanguageChange = event => {
        const locale = event.target.value;
        const userPreferences = { ...user_preferences, locale };
        setUserPreferences(userPreferences);
        hideSidePanel();
    };

    const makeExternalLink = (i, ix, arr) => {
        const cn = ix === arr.length - 1 ? 'last' : null;
        return (
            <li key={i.value} className={cn}>
                <a
                    href={i.link}
                    target={i.internal ? null : '_blank'}
                    rel="noopener noreferrer"
                >
                    {i.label}&nbsp;<Icon name="extlink" />
                </a>
            </li>
        );
    };

    const makeInternalLink = (i, ix, arr) => {
        const cn = ix === arr.length - 1 ? 'last' : null;
        if (i.key === 'switchLanguage') {
            return (
                <li key={ix} className={cn}>
                    <select
                        defaultValue={user_preferences.locale}
                        onChange={e => handleLanguageChange(e)}
                        onClick={e => e.nativeEvent.stopImmediatePropagation()}
                        className="language"
                    >
                        <option value="en">English</option>
                        <option value="es">Spanish Español</option>
                        <option value="ru">Russian русский</option>
                        <option value="fr">French français</option>
                        <option value="it">Italian italiano</option>
                        <option value="ko">Korean 한국어</option>
                        <option value="ja">Japanese 日本語</option>
                        <option value="pl">Polish</option>
                        <option value="zh">Chinese 简体中文</option>
                    </select>
                </li>
            );
        }
        return (
            <li key={i.value} className={cn}>
                <Link to={i.link}>{i.label}</Link>
            </li>
        );
    };

    const sidePanelLinks = {
        internal: [
            {
                value: 'welcome',
                label: tt('navigation.welcome'),
                link: `/welcome`,
            },
            {
                label: tt('g.choose_language'),
                link: '/',
                key: `switchLanguage`,
                value: 'language',
            },
            {
                value: 'faq',
                label: tt('navigation.faq'),
                link: `/faq.html`,
            },
            {
                value: 'market',
                label: tt('navigation.currency_market'),
                link: `/market`,
            },
            {
                value: 'recover_account_step_1',
                label: tt('navigation.stolen_account_recovery'),
                link: `/recover_account_step_1`,
            },
            {
                value: 'change_password',
                label: tt('navigation.change_account_password'),
                link: `/change_password`,
            },
            {
                value: 'vote_for_witnesses',
                label: tt('navigation.vote_for_witnesses'),
                link: `/~witnesses`,
            },
            {
                value: 'proposals',
                label: tt('navigation.steem_proposals'),
                link: `/proposals`,
            },
        ],
        exchanges: [
            {
                value: 'binance',
                label: 'Binance',
                link: 'https://www.binance.com/en/trade/STEEM_BTC',
            },
            {
                value: 'poloniex',
                label: 'Poloniex',
                link: 'https://poloniex.com/trade/STEEM_TRX/?type=spot',
            },
        ],
        external: [
            // {
            //     value: 'chat',
            //     label: tt('navigation.chat'),
            //     link: 'https://steem.chat/home',
            // },
            {
                value: 'jobs',
                label: tt('navigation.jobs'),
                link: 'https://jobs.lever.co/steemit',
            },
            // {
            //     value: 'tools',
            //     label: tt('navigation.app_center'),
            //     link: 'https://steemprojects.com/',
            // },
            {
                value: 'business',
                label: tt('navigation.business_center'),
                link: 'https://steemeconomy.com/',
            },
            {
                value: 'api_docs',
                label: tt('navigation.api_docs'),
                link: 'https://developers.steem.io/',
            },
        ],
        organizational: [
            {
                value: 'bluepaper',
                label: tt('navigation.bluepaper'),
                link: 'https://steem.io/steem-bluepaper.pdf',
            },
            {
                value: 'smt_whitepaper',
                label: tt('navigation.smt_whitepaper'),
                link: 'https://smt.steem.io/',
            },
            {
                value: 'whitepaper',
                label: tt('navigation.whitepaper'),
                link: 'https://steem.io/SteemWhitePaper.pdf',
            },
            {
                value: 'about',
                label: tt('navigation.about'),
                link: '/about.html',
                internal: true,
            },
        ],
        legal: [
            {
                value: 'privacy',
                label: tt('navigation.privacy_policy'),
                link: '/privacy.html',
            },
            {
                value: 'tos',
                label: tt('navigation.terms_of_service'),
                link: '/tos.html',
            },
        ],
        extras: [
            {
                value: 'login',
                label: tt('g.sign_in'),
                link: '/login.html',
            },
            {
                value: 'signup',
                label: tt('g.sign_up'),
                link: 'https://signup.steemit.com',
            },
            {
                value: 'post',
                label: tt('g.post'),
                link: '/submit.html',
            },
        ],
    };

    return (
        <div className="SidePanel">
            <div className={(visible ? 'visible ' : '') + alignment}>
                <CloseButton onClick={hideSidePanel} />
                <ul className={`vertical menu ${loggedIn}`}>
                    {makeInternalLink(
                        sidePanelLinks.extras[0],
                        0,
                        sidePanelLinks.extras
                    )}
                    {makeInternalLink(
                        sidePanelLinks.extras[1],
                        1,
                        sidePanelLinks.extras
                    )}
                    {makeExternalLink(
                        sidePanelLinks.extras[2],
                        2,
                        sidePanelLinks.extras
                    )}
                </ul>
                <ul className="vertical menu">
                    {sidePanelLinks.internal.map(makeInternalLink)}
                </ul>
                <ul className="vertical menu">
                    <li>
                        <a className="menu-section">
                            {tt('navigation.third_party_exchanges')}
                        </a>
                    </li>
                    {sidePanelLinks.exchanges.map(makeExternalLink)}
                </ul>
                <ul className="vertical menu">
                    {sidePanelLinks.external.map(makeExternalLink)}
                </ul>
                <ul className="vertical menu">
                    {sidePanelLinks.organizational.map(makeExternalLink)}
                </ul>
                <ul className="vertical menu">
                    {sidePanelLinks.legal.map(makeInternalLink)}
                </ul>
            </div>
        </div>
    );
};

SidePanel.propTypes = {
    alignment: PropTypes.oneOf(['left', 'right']).isRequired,
    visible: PropTypes.bool.isRequired,
    hideSidePanel: PropTypes.func.isRequired,
    username: PropTypes.string,
};

SidePanel.defaultProps = {
    username: undefined,
};

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const user_preferences = state.app.get('user_preferences').toJS();
        return {
            user_preferences,
            ...ownProps,
        };
    },
    // mapDispatchToProps
    dispatch => ({
        setUserPreferences: payload => {
            dispatch(appActions.setUserPreferences(payload));
        },
    })
)(SidePanel);