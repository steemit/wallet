/* eslint-disable no-script-url */
/* eslint-disable jsx-a11y/anchor-is-valid */
/* eslint-disable global-require */
/* eslint-disable jsx-a11y/alt-text */
/* eslint-disable jsx-a11y/label-has-for */
/* eslint-disable no-plusplus */
/* eslint-disable react/require-default-props */
/* eslint-disable react/forbid-prop-types */
/* eslint-disable no-undef */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import QRCode from 'react-qr';
import tt from 'counterpart';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import Keys from 'app/components/elements/Keys';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';

const keyTypes = ['Posting', 'Active', 'Owner', 'Memo'];

class UserKeys extends Component {
    static propTypes = {
        // HTML
        account: PropTypes.object.isRequired,
        // Redux
        isMyAccount: PropTypes.bool.isRequired,
        wifShown: PropTypes.bool,
        setWifShown: PropTypes.func.isRequired,
    };
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'UserKeys');
        this.state = {
            activeTab: 1,
        };
        this.onKey = {};
        keyTypes.forEach(key => {
            this.onKey[key] = (wif, pubkey) => {
                this.setState({ [key]: { wif, pubkey } });
            };
        });
        this.changeTab = this.changeTab.bind(this);
        this.onCreateTronAccount = this.onCreateTronAccount.bind(this);
    }
    componentWillUpdate(nextProps, nextState) {
        const { wifShown, setWifShown } = nextProps;
        let hasWif = false;
        let hasAllWifs = true;
        keyTypes.forEach(key => {
            const keyObj = nextState[key];
            if (keyObj && keyObj.wif) hasWif = true;
            else hasAllWifs = false;
        });
        if (wifShown !== hasWif) setWifShown(hasWif);
    }

    changeTab(e) {
        this.setState({
            activeTab: e,
        });
    }

    onCreateTronAccount = e => {
        e.target.blur();
        this.props.showTronCreate();
    };

    render() {
        const {
            props: { account, isMyAccount, currentUsername },
            state: { activeTab },
        } = this;
        const { onKey } = this;
        let idx = 0;
        const hasTronAddr = account.has('tron_addr');
        const tronAddr = account.get('tron_addr');

        // do not render if account is not loaded or available
        if (!account) return null;

        // do not render if state appears to contain only lite account info
        if (!account.has('vesting_shares')) return null;

        const wifQrs = keyTypes.map(key => {
            const keyObj = this.state[key];
            if (!keyObj) return null;
            return (
                <span key={idx++}>
                    <hr />
                    <div className="row">
                        <div className="column small-2">
                            <label>{tt('userkeys_jsx.public')}</label>
                            <QRCode text={keyObj.pubkey} />
                        </div>
                        <div className="column small-8">
                            <label>
                                {tt('userkeys_jsx.public_something_key', {
                                    key,
                                })}
                            </label>
                            <div className="overflow-ellipsis">
                                <code>
                                    <small>{keyObj.pubkey}</small>
                                </code>
                            </div>
                            {keyObj.wif && (
                                <div>
                                    <label>
                                        {tt(
                                            'userkeys_jsx.private_something_key',
                                            { key }
                                        )}
                                    </label>
                                    <div className="overflow-ellipsis">
                                        <code>
                                            <small>{keyObj.wif}</small>
                                        </code>
                                    </div>
                                </div>
                            )}
                        </div>
                        {keyObj.wif && (
                            <div className="column small-2">
                                <label>{tt('userkeys_jsx.private')}</label>
                                <QRCode text={keyObj.wif} />
                            </div>
                        )}
                    </div>
                </span>
            );
        });

        return (
            <div className="UserKeys columns">
                <div className="UserKeys__intro">
                    <div className="UserKeys__intro-col">
                        <h1>Keys & Permissions </h1>
                        <p className="UserKeys__p">
                            {tt('userkeys_jsx.userkeys_info_1')}
                        </p>
                        <p className="UserKeys__p">
                            {tt('userkeys_jsx.userkeys_info_2')}
                        </p>
                        <h5>{tt('userkeys_jsx.leare_more')}</h5>
                        <a
                            className="UserKeys__link"
                            href="https://steemit.com/steem/@steemitblog/steem-basics-understanding-private-keys-part-1"
                        >
                            Understanding Private Keys Part 1
                        </a>
                    </div>
                    <div className="UserKeys__intro-col">
                        <img
                            className="UserKeys__diagram"
                            src={require('app/assets/images/key-permissions.png')}
                        />
                    </div>
                </div>
                <ul className="user-keys-tabs WalletSubMenu menu">
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 1 ? 'active' : ''}`}
                            onClick={() => this.changeTab(1)}
                        >
                            {tt('userkeys_jsx.tron_account.title')}
                        </a>
                    </li>
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 2 ? 'active' : ''}`}
                            onClick={() => this.changeTab(2)}
                        >
                            {tt('userkeys_jsx.posting_key.title')}
                        </a>
                    </li>
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 3 ? 'active' : ''}`}
                            onClick={() => this.changeTab(3)}
                        >
                            {tt('userkeys_jsx.active_key.title')}
                        </a>
                    </li>
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 4 ? 'active' : ''}`}
                            onClick={() => this.changeTab(4)}
                        >
                            {tt('userkeys_jsx.owner_key.title')}
                        </a>
                    </li>
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 5 ? 'active' : ''}`}
                            onClick={() => this.changeTab(5)}
                        >
                            {tt('userkeys_jsx.memo_key.title')}
                        </a>
                    </li>
                    <li>
                        <a
                            href="javascript:;"
                            className={`${activeTab == 6 ? 'active' : ''}`}
                            onClick={() => this.changeTab(6)}
                        >
                            {tt('userkeys_jsx.public_key.title')}
                        </a>
                    </li>
                </ul>
                <div>
                    {activeTab == 1 && (
                        <div className="key">
                            <div className="key__content-container">
                                <div className="key__col">
                                    <p className="key__description">
                                        {tt('userkeys_jsx.tron_account.desc1')}
                                    </p>
                                    <p className="key__description">
                                        {tt('userkeys_jsx.tron_account.desc2')}
                                    </p>
                                    <p className="key__description">
                                        {tt('userkeys_jsx.tron_account.desc3')}
                                    </p>
                                    {hasTronAddr &&
                                        tronAddr && (
                                            <div>
                                                <div className="ShowKey">
                                                    <div className="row key__private">
                                                        <div className="key__private-title">
                                                            <h5>
                                                                {tt(
                                                                    'userkeys_jsx.tron_account.address'
                                                                )}
                                                            </h5>
                                                        </div>

                                                        <div className="key__private-container">
                                                            <div className="key__private-input">
                                                                <input
                                                                    className="key__input"
                                                                    type="text"
                                                                    value={
                                                                        tronAddr
                                                                    }
                                                                    readOnly
                                                                />
                                                            </div>
                                                            <div className="key__reveal">
                                                                <QRCode
                                                                    text={
                                                                        tronAddr
                                                                    }
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <h5
                                                    style={{
                                                        marginTop: '20px',
                                                    }}
                                                >
                                                    {tt(
                                                        'userkeys_jsx.tron_account.tron_key'
                                                    )}
                                                </h5>
                                                <p
                                                    style={{
                                                        paddingLeft: '10px',
                                                        fontSize: '0.875rem',
                                                        fontWeight: 500,
                                                    }}
                                                >
                                                    {tt(
                                                        'userkeys_jsx.tron_account.tron_key_tip'
                                                    )}
                                                </p>
                                            </div>
                                        )}
                                    {isMyAccount &&
                                        hasTronAddr &&
                                        !tronAddr && (
                                            <div>
                                                <div
                                                    style={{
                                                        width: '50%',
                                                    }}
                                                >
                                                    <button
                                                        className="UserWallet__tron button hollow"
                                                        style={{
                                                            width: '70%',
                                                            height: 'auto',
                                                        }}
                                                        onClick={
                                                            this
                                                                .onCreateTronAccount
                                                        }
                                                    >
                                                        {tt(
                                                            'userwallet_jsx.create_trx_button'
                                                        )}
                                                    </button>
                                                </div>
                                                <div
                                                    style={{
                                                        width: '50%',
                                                        marginTop: '10px',
                                                    }}
                                                >
                                                    <button
                                                        className="UserWallet__tron button hollow"
                                                        style={{
                                                            width: '70%',
                                                            height: 'auto',
                                                        }}
                                                        onClick={
                                                            this.props
                                                                .showBindExistTronAddr
                                                        }
                                                    >
                                                        {tt(
                                                            'userwallet_jsx.bind_exist_tron_addr'
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                </div>
                                <div className="key__col permissions">
                                    <h5 className="permissions__h5">
                                        {tt(
                                            'userkeys_jsx.tron_account.tron_account_permissions'
                                        )}
                                    </h5>
                                    <p className="permissions__p">
                                        {tt(
                                            'userkeys_jsx.tron_account.tron_account_permissions1'
                                        )}
                                    </p>
                                    <ul className="permissions__list">
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.tron_account.tron_account_permissions2'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.tron_account.tron_account_permissions3'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.tron_account.tron_account_permissions4'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.tron_account.tron_account_permissions5'
                                            )}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab == 2 && (
                        <div className="key">
                            <div className="key__title-container">
                                <h3>Posting Key</h3>
                            </div>
                            <div className="key__content-container">
                                <div className="key__col">
                                    <p className="key__description">
                                        {tt('userkeys_jsx.posting_key.desc1')}
                                    </p>
                                    <p className="key__description">
                                        {tt('userkeys_jsx.posting_key.desc2')}
                                    </p>
                                    <Keys
                                        account={account}
                                        authType="posting"
                                        onKey={onKey.Posting}
                                        title={
                                            'userkeys_jsx.posting_key.posting_key_title'
                                        }
                                    />
                                </div>
                                <div className="key__col permissions">
                                    <h5 className="permissions__h5">
                                        {tt(
                                            'userkeys_jsx.posting_key.Posting_Key_permissions'
                                        )}
                                    </h5>
                                    <p className="permissions__p">
                                        {tt(
                                            'userkeys_jsx.posting_key.Posting_Key_permissions1'
                                        )}
                                    </p>
                                    <ul className="permissions__list">
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions2'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions3'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions4'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions5'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions6'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.posting_key.Posting_Key_permissions7'
                                            )}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab == 3 && (
                        <div className="key">
                            <div className="key__title-container">
                                <h3>Active Key</h3>
                            </div>
                            <div className="key__content-container">
                                <div className="key__col">
                                    <p className="key__description">
                                        {tt('userkeys_jsx.active_key.desc1')}
                                    </p>
                                    <p className="key__description">
                                        {tt('userkeys_jsx.active_key.desc2')}
                                    </p>

                                    <Keys
                                        account={account}
                                        authType="active"
                                        onKey={onKey.Active}
                                        title={
                                            'userkeys_jsx.active_key.active_key_title'
                                        }
                                    />
                                </div>
                                <div className="key__col permissions">
                                    <h5 className="permissions__h5">
                                        {tt(
                                            'userkeys_jsx.active_key.active_Key_permissions'
                                        )}
                                    </h5>
                                    <p className="permissions__p">
                                        {tt(
                                            'userkeys_jsx.active_key.active_Key_permissions1'
                                        )}
                                    </p>
                                    <ul className="permissions__list">
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions2'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions3'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions4'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions5'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions6'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions7'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions8'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.active_key.active_Key_permissions9'
                                            )}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab == 4 && (
                        <div className="key">
                            <div className="key__title-container">
                                <h3>Owner Key</h3>
                            </div>
                            <div className="key__content-container">
                                <div className="key__col">
                                    <p className="key__description">
                                        {tt('userkeys_jsx.owner_key.desc')}
                                    </p>
                                    <Keys
                                        account={account}
                                        authType="owner"
                                        onKey={onKey.Owner}
                                        title={
                                            'userkeys_jsx.owner_key.owner_key_title'
                                        }
                                    />
                                </div>
                                <div className="key__col permissions">
                                    <h5 className="permissions__h5">
                                        {tt(
                                            'userkeys_jsx.owner_key.owner_Key_permissions'
                                        )}
                                    </h5>
                                    <p className="permissions__p">
                                        {tt(
                                            'userkeys_jsx.owner_key.owner_Key_permissions1'
                                        )}
                                    </p>
                                    <ul className="permissions__list">
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.owner_key.owner_Key_permissions2'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.owner_key.owner_Key_permissions3'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.owner_key.owner_Key_permissions4'
                                            )}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab == 5 && (
                        <div className="key">
                            <div className="key__title-container">
                                <h3>Memo Key</h3>
                            </div>
                            <div className="key__content-container">
                                <div className="key__col">
                                    <p className="key__description">
                                        {tt('userkeys_jsx.memo_key.desc')}
                                    </p>
                                    <Keys
                                        account={account}
                                        authType="memo"
                                        onKey={onKey.Memo}
                                        title={
                                            'userkeys_jsx.memo_key.memo_key_title'
                                        }
                                    />
                                </div>
                                <div className="key__col permissions">
                                    <h5 className="permissions__h5">
                                        {tt(
                                            'userkeys_jsx.memo_key.memo_Key_permissions'
                                        )}
                                    </h5>
                                    <p className="permissions__p">
                                        {tt(
                                            'userkeys_jsx.memo_key.memo_Key_permissions1'
                                        )}
                                    </p>
                                    <ul className="permissions__list">
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.memo_key.memo_Key_permissions2'
                                            )}
                                        </li>
                                        <li className="permissions__li">
                                            {tt(
                                                'userkeys_jsx.memo_key.memo_Key_permissions3'
                                            )}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab == 6 && (
                        <div className="key">
                            <div className="key__col">
                                <p className="public-keys__description">
                                    {tt('userkeys_jsx.public_key.desc1')}
                                </p>
                                <p className="public-keys__description">
                                    {tt('userkeys_jsx.public_key.desc2')}{' '}
                                    <a
                                        className="public-keys__link"
                                        href={
                                            'https://steemscan.com/account/' +
                                            account.get('name')
                                        }
                                    >
                                        steemscan.com/account/{account.get(
                                            'name'
                                        )}
                                    </a>
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const { account } = ownProps;
        const isMyAccount =
            state.user.getIn(['current', 'username'], false) ===
            account.get('name');
        const wifShown = state.global.get('UserKeys_wifShown');
        const currentUsername = state.user.getIn(['current', 'username']);
        return { ...ownProps, isMyAccount, wifShown, currentUsername };
    },
    dispatch => ({
        setWifShown: shown => {
            dispatch(globalActions.receiveState({ UserKeys_wifShown: shown }));
        },
        showTronCreate: e => {
            if (e) e.preventDefault();
            dispatch(userActions.showTronCreate());
        },
        showBindExistTronAddr: e => {
            if (e) e.preventDefault();
            dispatch(userActions.showBindExistTronAddr());
        },
    })
)(UserKeys);
