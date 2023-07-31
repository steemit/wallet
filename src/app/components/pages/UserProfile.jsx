/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint react/prop-types: 0 */
import React from 'react';
import { Link, browserHistory } from 'react-router';
import { connect } from 'react-redux';
import classnames from 'classnames';
import * as globalActions from 'app/redux/GlobalReducer';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import { actions as fetchDataSagaActions } from 'app/redux/FetchDataSaga';
import Icon from 'app/components/elements/Icon';
import UserKeys from 'app/components/elements/UserKeys';
import PasswordReset from 'app/components/elements/PasswordReset';
import CreateCommunity from 'app/components/elements/CreateCommunity';
import Delegations from 'app/components/modules/Delegations';
import UserWallet from 'app/components/modules/UserWallet';
import Settings from 'app/components/modules/Settings';
import CurationRewards from 'app/components/modules/CurationRewards';
import AuthorRewards from 'app/components/modules/AuthorRewards';
import UserList from 'app/components/elements/UserList';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { isFetchingOrRecentlyUpdated } from 'app/utils/StateFunctions';
import Tooltip from 'app/components/elements/Tooltip';
import DateJoinWrapper from 'app/components/elements/DateJoinWrapper';
import tt from 'counterpart';
import { List } from 'immutable';
import WalletSubMenu from 'app/components/elements/WalletSubMenu';
import Userpic from 'app/components/elements/Userpic';
import Callout from 'app/components/elements/Callout';
import normalizeProfile from 'app/utils/NormalizeProfile';
import userIllegalContent from 'app/utils/userIllegalContent';
import proxifyImageUrl from 'app/utils/ProxifyUrl';
import SanitizedLink from 'app/components/elements/SanitizedLink';
import DropdownMenu from 'app/components/elements/DropdownMenu';

export default class UserProfile extends React.Component {
    constructor() {
        super();
        this.state = { showResteem: true };
        this.onPrint = () => {
            window.print();
        };
        this.redirect = this.redirect.bind(this);
    }

    componentWillMount() {
        this.props.setRouteTag(this.props.accountname);
        this.redirect();
    }

    shouldComponentUpdate(np, ns) {
        return (
            np.currentUser !== this.props.currentUser ||
            np.account !== this.props.account ||
            np.wifShown !== this.props.wifShown ||
            np.globalStatus !== this.props.globalStatus ||
            np.loading !== this.props.loading ||
            np.location.pathname !== this.props.location.pathname ||
            ns.showResteem !== this.state.showResteem
        );
    }

    componentDidUpdate(prevProps) {
        this.redirect();
    }

    componentWillUnmount() {
        this.props.clearTransferDefaults();
        this.props.clearPowerdownDefaults();
    }

    redirect() {
        const {
            accountname,
            routeParams: { section },
        } = this.props;
        // Redirect user homepage to transfers page
        if (!section) {
            if (process.env.BROWSER) {
                browserHistory.replace(`/@${accountname}/transfers`);
            }
        }
    }

    render() {
        const {
            state: { showResteem },
            props: {
                currentUser,
                wifShown,
                globalStatus,
                accountname,
                isMyAccount,
                socialUrl,
                routeParams: { section },
            },
            onPrint,
        } = this;

        // Loading status
        const status = globalStatus
            ? globalStatus.getIn([section, 'by_author'])
            : null;
        const fetching = (status && status.fetching) || this.props.loading;

        let account;
        const accountImm = this.props.account;
        if (accountImm) {
            account = accountImm.toJS();
        } else if (fetching) {
            return (
                <center>
                    <LoadingIndicator type="circle" />
                </center>
            );
        } else {
            return (
                <div>
                    <center>{tt('user_profile.unknown_account')}</center>
                </div>
            );
        }

        let tab_content = null;

        let rewardsClass = '',
            walletClass = '';
        if (section === 'transfers') {
            walletClass = 'active';
            tab_content = (
                <div>
                    <UserWallet
                        account={accountImm}
                        showTransfer={this.props.showTransfer}
                        showTronTransfer={this.props.showTronTransfer}
                        showPowerdown={this.props.showPowerdown}
                        showVote={this.props.showVote}
                        currentUser={currentUser}
                        withdrawVesting={this.props.withdrawVesting}
                    />
                </div>
            );
        }
        else if (section === 'delegations') {
            walletClass = 'active';
            tab_content = (
                <div>
                    <Delegations
                        account={accountImm}
                        showTransfer={this.props.showTransfer}
                        showPowerdown={this.props.showPowerdown}
                        currentUser={currentUser}
                        withdrawVesting={this.props.withdrawVesting}
                    />
                </div>
            );
        }
        else if (section === 'curation-rewards') {
            rewardsClass = 'active';
            tab_content = <CurationRewards account={account} />;
        } else if (section === 'author-rewards') {
            rewardsClass = 'active';
            tab_content = <AuthorRewards account={account} />;
        } else if (section === 'settings') {
            tab_content = <Settings routeParams={this.props.routeParams} />;
        } else if (section === 'permissions') {
            walletClass = 'active';
            tab_content = (
                <div>
                    <div className="row">
                        <div className="column">
                            <WalletSubMenu
                                accountname={account.name}
                                isMyAccount={isMyAccount}
                                showTab="permissions"
                            />
                        </div>
                    </div>
                    <br />
                    <UserKeys account={accountImm} isMyAccount={isMyAccount} />
                </div>
            );
        } else if (section === 'password') {
            walletClass = 'active';
            tab_content = (
                <div>
                    <div className="row">
                        <div className="column">
                            <WalletSubMenu
                                accountname={account.name}
                                isMyAccount={isMyAccount}
                                showTab="password"
                            />
                        </div>
                    </div>
                    <br />
                    <PasswordReset account={accountImm} />
                </div>
            );
        } else if (section === 'communities') {
            walletClass = 'active';
            tab_content = (
                <div>
                    <div className="row">
                        <div className="column">
                            <WalletSubMenu
                                accountname={account.name}
                                isMyAccount={isMyAccount}
                                showTab="communities"
                            />
                        </div>
                    </div>
                    <br />
                    <CreateCommunity account={accountImm} />
                </div>
            );
        } else {
            console.log('no matches. section:', section);
            tab_content = <div>Invalid Page</div>;
        }

        // detect illegal users
        if (userIllegalContent.includes(accountname)) {
            tab_content = <div>Unavailable For Legal Reasons.</div>;
        }

        let printLink = null;
        if (section === 'permissions') {
            if (wifShown) {
                printLink = (
                    <div>
                        <a className="float-right noPrint" onClick={onPrint}>
                            <Icon name="printer" />&nbsp;{tt('g.print')}&nbsp;&nbsp;
                        </a>
                    </div>
                );
            }
        }

        const rewardsMenu = [
            {
                link: `/@${accountname}/curation-rewards`,
                label: tt('g.curation_rewards'),
                value: tt('g.curation_rewards'),
            },
            {
                link: `/@${accountname}/author-rewards`,
                label: tt('g.author_rewards'),
                value: tt('g.author_rewards'),
            },
        ];

        const top_menu = (
            <div className="row UserProfile__top-menu">
                <div className="columns small-10 medium-12 medium-expand">
                    <ul className="menu" style={{ flexWrap: 'wrap' }}>
                        <li>
                            <a
                                href={`${socialUrl}/@${accountname}`}
                                target="_blank"
                            >
                                {tt('g.blog')}
                            </a>
                        </li>
                        <DropdownMenu
                            className={rewardsClass}
                            items={rewardsMenu}
                            el="li"
                            selected={tt('g.rewards')}
                            position="right"
                        />
                    </ul>
                </div>
                <div className="columns shrink">
                    <ul className="menu" style={{ flexWrap: 'wrap' }}>
                        <li>
                            <a
                                href={`/@${accountname}/transfers`}
                                className={walletClass}
                                onClick={e => {
                                    e.preventDefault();
                                    browserHistory.push(e.target.pathname);
                                    return false;
                                }}
                            >
                                {tt('g.wallet')}
                            </a>
                        </li>
                        {/*isMyAccount ? (
                            <li>
                                <Link
                                    to={`/@${accountname}/settings`}
                                    activeClassName="active"
                                >
                                    {tt('g.settings')}
                                </Link>
                            </li>
                        ) : null*/}
                    </ul>
                </div>
            </div>
        );

        const {
            name,
            location,
            about,
            website,
            cover_image,
        } = normalizeProfile(account);
        const website_label = website
            ? website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
            : null;

        let cover_image_style = {};
        if (cover_image) {
            cover_image_style = {
                backgroundImage:
                    'url(' + proxifyImageUrl(cover_image, '2048x512') + ')',
            };
        }

        return (
            <div className="UserProfile">
                <div className="UserProfile__banner row expanded">
                    <div className="column" style={cover_image_style}>
                        <h1>
                            <Userpic account={account.name} hideIfDefault />
                            {name || account.name}
                        </h1>

                        <div>
                            {about && (
                                <p className="UserProfile__bio">{about}</p>
                            )}
                            <p className="UserProfile__info">
                                {location && (
                                    <span>
                                        <Icon name="location" /> {location}
                                    </span>
                                )}
                                {website && (
                                    <span>
                                        <Icon name="link" />{' '}
                                        <SanitizedLink
                                            url={website}
                                            text={website_label}
                                        />
                                    </span>
                                )}
                                <Icon name="calendar" />{' '}
                                <DateJoinWrapper date={account.created} />
                            </p>
                        </div>
                    </div>
                </div>
                <div className="UserProfile__top-nav row expanded noPrint">
                    {top_menu}
                </div>
                {/* <div>{printLink}</div> */}
                <div>{tab_content}</div>
            </div>
        );
    }
}

module.exports = {
    path: '@:accountname(/:section)',
    component: connect(
        (state, ownProps) => {
            const wifShown = state.global.get('UserKeys_wifShown');
            const currentUser = state.user.get('current');
            const socialUrl = state.app.get('socialUrl');
            const accountname = ownProps.routeParams.accountname.toLowerCase();
            const isMyAccount =
                currentUser && currentUser.get('username') === accountname;
            return {
                loading: state.app.get('loading'),
                globalStatus: state.global.get('status'),
                account: state.global.getIn(['accounts', accountname]),
                discussions: state.global.get('discussion_idx'),
                wifShown,
                currentUser,
                accountname,
                isMyAccount,
                socialUrl,
            };
        },
        dispatch => ({
            showVote: () => {
                dispatch(userActions.showVote());
            },
            login: () => {
                dispatch(userActions.showLogin());
            },
            clearTransferDefaults: () => {
                dispatch(userActions.clearTransferDefaults());
            },
            showTransfer: transferDefaults => {
                dispatch(userActions.setTransferDefaults(transferDefaults));
                dispatch(userActions.showTransfer());
            },
            showTronTransfer: transferDefaults => {
                dispatch(userActions.showTronTransfer(transferDefaults));
            },
            clearPowerdownDefaults: () => {
                dispatch(userActions.clearPowerdownDefaults());
            },
            showPowerdown: powerdownDefaults => {
                console.log('power down defaults:', powerdownDefaults);
                dispatch(userActions.setPowerdownDefaults(powerdownDefaults));
                dispatch(userActions.showPowerdown());
            },
            withdrawVesting: ({
                account,
                vesting_shares,
                errorCallback,
                successCallback,
            }) => {
                const successCallbackWrapper = (...args) => {
                    dispatch(
                        globalActions.getState({ url: `@${account}/transfers` })
                    );
                    return successCallback(...args);
                };
                dispatch(
                    transactionActions.broadcastOperation({
                        type: 'withdraw_vesting',
                        operation: { account, vesting_shares },
                        errorCallback,
                        successCallback: successCallbackWrapper,
                    })
                );
            },
            requestData: args =>
                dispatch(fetchDataSagaActions.requestData(args)),
            setRouteTag: accountname =>
                dispatch(
                    appActions.setRouteTag({
                        routeTag: 'user_index',
                        params: {
                            accountname,
                        },
                    })
                ),
        })
    )(UserProfile),
};
