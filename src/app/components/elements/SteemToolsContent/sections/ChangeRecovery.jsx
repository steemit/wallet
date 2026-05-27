import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { validate_account_name } from 'app/utils/ChainValidation';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';
import ConfirmChangeRecoveryAccount from 'app/components/elements/ConfirmChangeRecoveryAccount';

class ChangeRecovery extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            newRecoveryAccount: '',
            loading: false,
            error: null,
            success: null,
            nameError: null,
            nameAvailable: null,
            isCheckingName: false,
            acknowledged: false,
        };
        this.checkAccountNameTimer = null;

        this.onChange = this.onChange.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.checkAccountName = this.checkAccountName.bind(this);
        this.onAcknowledgeToggle = this.onAcknowledgeToggle.bind(this);
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
            newRecoveryAccount: value,
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
                    if (this.state.newRecoveryAccount === normalizedUsername) {
                        let existsError = !exists ? tt('steem_tools.change_recovery_account.error_account_not_found') : null;
                        if (exists && this.props.accountName === normalizedUsername) {
                            existsError = tt('steem_tools.change_recovery_account.error_same_account', { fallback: 'Cannot change to the same account' });
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
                    if (this.state.newRecoveryAccount === normalizedUsername) {
                        this.setState({ isCheckingName: false });
                    }
                });
        }, 500);
    }
    
    onAcknowledgeToggle(e) {
        this.setState({ acknowledged: e.target.checked });
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt('steem_tools.change_recovery_account.unexpected_error');
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess() {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState({
            loading: false,
            error: null,
            success: tt('steem_tools.change_recovery_account.success_message'),
            newRecoveryAccount: '',
        });
    }

    onSubmit() {
        const { currentUser, account, accountName, changeRecoveryAccount } = this.props;
        const { newRecoveryAccount, acknowledged } = this.state;
        
        if (!acknowledged) {
            return;
        }

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.change_recovery_account.error_no_account'),
                success: null,
            });
            return;
        }

        let recoveryAccount = '';
        let pendingRecoveryAccount = '';

        if (account) {
            const recoveryInfo = account.get('account_recovery');
            if (recoveryInfo) {
                pendingRecoveryAccount = recoveryInfo.get('recovery_account') || '';
            }
            recoveryAccount = account.get('recovery_account') || '';
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.change_recovery_account.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.change_recovery_account.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (!newRecoveryAccount) {
            this.setState({
                error: tt('g.required'),
                success: null,
            });
            return;
        }

        if (this.state.nameError || !this.state.nameAvailable) {
            this.setState({
                error: tt('steem_tools.change_recovery_account.error_invalid_account'),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        changeRecoveryAccount(
            accountName,
            recoveryAccount,
            pendingRecoveryAccount,
            newRecoveryAccount,
            this.onSuccess,
            this.onFailure
        );
    }

    render() {
        const { currentUser, account, accountName } = this.props;
        const { newRecoveryAccount, loading, error, success, nameError, nameAvailable, isCheckingName, acknowledged } = this.state;

        let recoveryAccount = '';
        let pendingRecoveryAccount = '';
        let daysLeft = 0;

        if (account) {
            const recoveryInfo = account.get('account_recovery');
            if (recoveryInfo) {
                pendingRecoveryAccount = (recoveryInfo.get('recovery_account') || '').trim();

                const effectiveOn = recoveryInfo.get('effective_on');
                if (effectiveOn) {
                    const effectiveDate = new Date(effectiveOn);
                    const now = new Date();
                    daysLeft = Math.ceil((effectiveDate - now) / (1000 * 60 * 60 * 24));
                    if (daysLeft < 0) daysLeft = 0;
                }
            }
            recoveryAccount = account.get('recovery_account') || '';
        }

        const isOwner =
            !!currentUser &&
            !!accountName &&
            currentUser === accountName;

        const canChangeRecovery = !loading && isOwner;

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.change_recovery_account.title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.change_recovery_account.faq_link_message"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div>
                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.change_recovery_account.current_account')}</div>
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

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.change_recovery_account.current_recovery_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        type="text"
                                        value={recoveryAccount}
                                        disabled
                                        className="input-group-field bold"
                                    />
                                </div>
                            </div>
                        </div>

                        {pendingRecoveryAccount ? (
                            <div className="row row-column-mobile">
                                <div
                                    className="column flex-container-1-extended flex-mobile-full"
                                    style={{ paddingTop: 5 }}
                                >
                                    <div>{tt('steem_tools.change_recovery_account.pending_recovery_account')}</div>
                                </div>
                                <div className="column flex-container-2-extended flex-mobile-full">
                                    <div className="input-group" style={{ marginBottom: '0.5rem' }}>
                                        <span className="input-group-label">@</span>
                                        <input
                                            type="text"
                                            value={pendingRecoveryAccount}
                                            disabled
                                            className="input-group-field bold"
                                        />
                                    </div>
                                    {daysLeft > 0 ? (
                                        <div className="change-recovery-account-hint">
                                            {tt('steem_tools.change_recovery_account.days_left_message', { days: daysLeft })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ) : null}

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>{tt('steem_tools.change_recovery_account.new_account')}</div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div className={`input-group ${nameError ? 'advtools-input-group-error' : ''}`} style={{ marginBottom: nameError ? '0.25rem' : '0.5rem', position: 'relative' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        className={'input-group-field bold' + (nameError ? ' advtools-input-error' : (nameAvailable ? ' advtools-input-success' : ''))}
                                        type="text"
                                        name="newRecoveryAccount"
                                        value={newRecoveryAccount}
                                        onChange={this.onChange}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck="false"
                                        disabled={!canChangeRecovery}
                                        placeholder={tt('steem_tools.change_recovery_account.new_account_placeholder')}
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
                                        {tt('steem_tools.change_recovery_account.success_account_found', { fallback: 'Account found' })}
                                    </div>
                                )}
                                {!nameError && !nameAvailable && !isCheckingName && (
                                    <div className="change-recovery-account-hint">
                                        {tt('steem_tools.change_recovery_account.new_account_hint')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {!loading && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt('steem_tools.change_recovery_account.error_not_allowed')}
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

                        <div className="row" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                            <div className="column toggle_container advtools-acknowledge-check">
                                <span>
                                    {tt('steem_tools.change_recovery_account.acknowledge_warning')}
                                </span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={acknowledged}
                                        onChange={this.onAcknowledgeToggle}
                                    />
                                    <span className="slider round" />
                                </label>
                            </div>
                        </div>

                        <div className="row">
                            <div className="column">
                                {loading ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        className="button advtools-btn-primary"
                                        onClick={this.onSubmit}
                                        disabled={!canChangeRecovery || !nameAvailable || isCheckingName || !acknowledged}
                                    >
                                        {tt('steem_tools.change_recovery_account.submit_btn')}
                                    </button>
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
        changeRecoveryAccount: (
            account,
            current_recovery_account,
            pending_recovery_account,
            new_account,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${account}/transfers` }));
                if (successCallback) successCallback();
            };

            const operation = {
                account_to_recover: account,
                new_recovery_account: new_account,
                extensions: [],
            };

            const confirm = () => (
                pending_recovery_account
                    ? (
                        <ConfirmChangeRecoveryAccount
                            operation={{
                                current_account: account,
                                current_recovery_account,
                                pending_recovery_account,
                                new_recovery_account: new_account,
                            }}
                        />
                    ) : (
                        <ConfirmChangeRecoveryAccount
                            operation={{
                                current_account: account,
                                current_recovery_account,
                                new_recovery_account: new_account,
                            }}
                        />
                    )
            );

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'change_recovery_account',
                    operation,
                    successCallback: successCb,
                    errorCallback,
                    confirm,
                })
            );
        },
        refreshAccount: username =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: key => dispatch(appActions.removeNotification({ key })),
    })
)(ChangeRecovery);
