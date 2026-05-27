import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { FormattedHTMLMessage } from 'app/Translator';
import { api } from '@steemit/steem-js';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { validate_account_name } from 'app/utils/ChainValidation';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';

class UpdateProxy extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            proxyAccount: '',
            loading: false,
            error: null,
            success: null,
            nameError: null,
            nameAvailable: null,
            isCheckingName: false,
        };
        this.checkAccountNameTimer = null;

        this.onChange = this.onChange.bind(this);
        this.onSetProxy = this.onSetProxy.bind(this);
        this.onClearProxy = this.onClearProxy.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.checkAccountName = this.checkAccountName.bind(this);
    }

    componentWillUnmount() {
        if (this.checkAccountNameTimer) {
            clearTimeout(this.checkAccountNameTimer);
        }
    }

    onChange(e) {
        const value = e.target.value.replace(/\s/g, '').toLowerCase();
        const nameValidationError = value ? validate_account_name(value) : null;

        this.setState({
            proxyAccount: value,
            nameError: nameValidationError,
            nameAvailable: null,
            isCheckingName: false,
            error: null,
            success: null,
        });

        if (this.checkAccountNameTimer) {
            clearTimeout(this.checkAccountNameTimer);
        }

        if (value && !nameValidationError) {
            this.checkAccountName(value);
        }
    }

    checkAccountName(username) {
        this.setState({ nameAvailable: null });
        this.checkAccountNameTimer = setTimeout(() => {
            this.setState({ isCheckingName: true });
            const normalizedUsername = username.trim().toLowerCase();
            api.callAsync('condenser_api.lookup_accounts', [normalizedUsername, 1])
                .then(accounts => {
                    const exists = Array.isArray(accounts) && accounts.length > 0 && String(accounts[0]).toLowerCase() === normalizedUsername;
                    if (this.state.proxyAccount === normalizedUsername) {
                        let existsError = !exists ? tt('steem_tools.update_proxy.error_account_not_found', { fallback: 'Account not found. Proxy account must exist.' }) : null;

                        const currentProxy = this.props.account && typeof this.props.account.get === 'function' ? (this.props.account.get('proxy') || '') : '';

                        if (exists && currentProxy === normalizedUsername) {
                            existsError = tt('steem_tools.update_proxy.error_same_proxy', { fallback: 'The name must be different from the current proxy' });
                        } else if (exists && this.props.accountName === normalizedUsername) {
                            existsError = tt('steem_tools.update_proxy.error_same_account', { fallback: 'Cannot proxy to the same account' });
                        }

                        this.setState({
                            nameAvailable: exists && !existsError,
                            isCheckingName: false,
                            nameError: existsError
                        });
                    }
                })
                .catch(e => {
                    console.error('API Error checking account name:', e);
                    if (this.state.proxyAccount === normalizedUsername) {
                        this.setState({ isCheckingName: false });
                    }
                });
        }, 500);
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt('steem_tools.update_proxy.unexpected_error');
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess(successKey = 'steem_tools.update_proxy.success_message') {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState({
            loading: false,
            error: null,
            success: tt(successKey),
            proxyAccount: '',
        });
    }

    validateAndSubmit(proxyAccountValue, successKey) {
        const { currentUser, accountName, updateProxy } = this.props;
        const normalizedProxy = String(proxyAccountValue || '').trim().toLowerCase();

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (normalizedProxy && !/^[a-z0-9\-\.]+$/.test(normalizedProxy)) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_invalid_proxy_account'),
                success: null,
            });
            return;
        }

        if (normalizedProxy && normalizedProxy === accountName) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_same_account'),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        updateProxy(
            accountName,
            normalizedProxy,
            () => this.onSuccess(successKey),
            this.onFailure
        );
    }

    onSetProxy() {
        const { proxyAccount, nameError, nameAvailable } = this.state;

        if (!proxyAccount) {
            this.setState({
                error: tt('g.required', { fallback: 'Required' }),
                success: null,
            });
            return;
        }

        if (nameError || !nameAvailable) {
            this.setState({
                error: tt('steem_tools.update_proxy.error_invalid_account', { fallback: 'Invalid proxy account' }),
                success: null,
            });
            return;
        }

        this.validateAndSubmit(proxyAccount, 'steem_tools.update_proxy.success_message');
    }

    onClearProxy() {
        this.validateAndSubmit('', 'steem_tools.update_proxy.success_clear_message');
    }

    render() {
        const { currentUser, accountName, account } = this.props;
        const { proxyAccount, loading, error, success, nameError, nameAvailable, isCheckingName } = this.state;

        const currentProxy = account && typeof account.get === 'function'
            ? (account.get('proxy') || '')
            : '';

        const isOwner =
            !!currentUser &&
            !!accountName &&
            currentUser === accountName;

        const canEdit = !loading && isOwner;
        const canSubmit = canEdit && nameAvailable && !isCheckingName && !!proxyAccount;
        const canClear = canEdit && !!currentProxy;

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.update_proxy.title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.update_proxy.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.update_proxy.current_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        type="text"
                                        value={accountName || ''}
                                        disabled
                                        className="input-group-field bold"
                                    />
                                </div>
                            </div>
                        </div>

                        {currentProxy ? (
                            <div className="row row-column-mobile">
                                <div
                                    className="column flex-container-1-extended flex-mobile-full"
                                    style={{ paddingTop: 5 }}
                                >
                                    <div>{tt('steem_tools.update_proxy.current_proxy_account')}</div>
                                </div>
                                <div className="column flex-container-2-extended flex-mobile-full">
                                    <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                        <span className="input-group-label">@</span>
                                        <input
                                            type="text"
                                            value={currentProxy}
                                            disabled
                                            className="input-group-field bold"
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.update_proxy.proxy_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className={`input-group ${nameError ? 'advtools-input-group-error' : ''}`} style={{ marginBottom: nameError ? '0.25rem' : '0.5rem', position: 'relative' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        className={'input-group-field bold' + (nameError ? ' advtools-input-error' : (nameAvailable ? ' advtools-input-success' : ''))}
                                        type="text"
                                        name="proxyAccount"
                                        value={proxyAccount}
                                        onChange={this.onChange}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck="false"
                                        disabled={!canEdit}
                                        placeholder={tt('steem_tools.update_proxy.proxy_account_placeholder')}
                                    />
                                    {isCheckingName && (
                                        <div style={{ position: 'absolute', right: '12px', top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', opacity: 0.7 }}>
                                            <LoadingIndicator type="circle" />
                                        </div>
                                    )}
                                </div>
                                {nameError && (
                                    <div className="advtools-error-hint">
                                        {nameError}
                                    </div>
                                )}
                                {nameAvailable === true && !nameError && (
                                    <div className="advtools-error-hint" style={{ color: 'var(--accent)' }}>
                                        {tt('steem_tools.update_proxy.success_account_found', { fallback: 'Account found' })}
                                    </div>
                                )}
                                {!nameError && !nameAvailable && !isCheckingName && (
                                    <div className="change-recovery-account-hint">
                                        {tt('steem_tools.update_proxy.proxy_account_hint')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {!loading && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.update_proxy.error_not_allowed')}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">{error}</div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">{success}</div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row">
                            <div className="column">
                                {loading ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : (
                                    <span style={{ display: 'inline-flex', gap: '1rem', alignItems: 'center' }}>
                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onSetProxy}
                                            disabled={!canSubmit}
                                            style={{ margin: 0 }}
                                        >
                                            {tt('steem_tools.update_proxy.set_proxy_btn')}
                                        </button>
                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onClearProxy}
                                            disabled={!canClear}
                                            style={{
                                                margin: 0,
                                            }}
                                        >
                                            {tt('steem_tools.update_proxy.clear_proxy_btn')}
                                        </button>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');

        const accountName =
            ownProps.accountname ||
            currentUser ||
            '';

        const account = accountName
            ? state.global.getIn(['accounts', accountName])
            : null;

        return {
            currentUser,
            accountName,
            account,
        };
    },
    dispatch => ({
        updateProxy: (
            account,
            proxy,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${account}/witnesses` }));
                if (successCallback) successCallback();
            };

            const operation = {
                account,
                proxy,
            };

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'account_witness_proxy',
                    operation,
                    successCallback: successCb,
                    errorCallback,
                })
            );
        },
        refreshAccount: username =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(UpdateProxy);
