import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';

class DeclineVoting extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            confirmPermanentDecline: false,
            loading: false,
            checkingRequest: false,
            hasPendingDeclineRequest: false,
            declineRequest: null,
            requestLookupError: null,
            error: null,
            success: null,
        };

        this.requestLookupSeq = 0;
        this.unmounted = false;

        this.onCheckboxChange = this.onCheckboxChange.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onSubmitCancel = this.onSubmitCancel.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.loadDeclineRequestStatus =
            this.loadDeclineRequestStatus.bind(this);
        this.extractRequests = this.extractRequests.bind(this);
        this.formatEffectiveDate = this.formatEffectiveDate.bind(this);
        this.getPendingDeclineMeta = this.getPendingDeclineMeta.bind(this);
    }

    componentDidMount() {
        this.loadDeclineRequestStatus(this.props);
    }

    componentDidUpdate(prevProps) {
        if (
            prevProps.accountName !== this.props.accountName ||
            prevProps.currentUser !== this.props.currentUser
        ) {
            this.setState(
                {
                    confirmPermanentDecline: false,
                    error: null,
                    success: null,
                },
                () => this.loadDeclineRequestStatus(this.props)
            );
        }
    }

    componentWillUnmount() {
        this.unmounted = true;
    }

    onCheckboxChange(e) {
        this.setState({
            confirmPermanentDecline: e.target.checked,
            error: null,
            success: null,
        });
    }

    extractRequests(result) {
        if (Array.isArray(result)) return result;
        if (result && Array.isArray(result.requests)) return result.requests;
        return [];
    }

    formatEffectiveDate(value) {
        const raw = String(value || '').trim();
        const match = raw.match(
            /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/
        );

        if (!match) return raw;

        const [, year, month, day] = match;
        return `${day}-${month}-${year}`;
    }

    getPendingDeclineMeta() {
        const { declineRequest } = this.state;
        const effectiveRaw =
            declineRequest && declineRequest.effective_date
                ? declineRequest.effective_date
                : null;

        if (!effectiveRaw) {
            return {
                daysLeft: null,
                dayLabel: null,
                effectiveDateText: '',
            };
        }

        const effectiveDate = new Date(effectiveRaw);
        const now = new Date();

        const daysLeft = Math.max(
            0,
            Math.ceil((effectiveDate - now) / (1000 * 60 * 60 * 24))
        );

        return {
            daysLeft,
            dayLabel: daysLeft === 1 ? 'day' : 'days',
            effectiveDateText: this.formatEffectiveDate(effectiveRaw),
        };
    }

    loadDeclineRequestStatus(props = this.props) {
        const { currentUser, accountName } = props;
        const lookupSeq = ++this.requestLookupSeq;

        if (!currentUser || !accountName || currentUser !== accountName) {
            this.setState({
                checkingRequest: false,
                hasPendingDeclineRequest: false,
                declineRequest: null,
                requestLookupError: null,
                confirmPermanentDecline: false,
            });
            return;
        }

        this.setState({
            checkingRequest: true,
            requestLookupError: null,
        });

        api.callAsync('database_api.find_decline_voting_rights_requests', {
            accounts: [accountName],
        })
            .then((result) => {
                if (this.unmounted || lookupSeq !== this.requestLookupSeq) {
                    return;
                }

                const requests = this.extractRequests(result);
                const normalizedAccount = String(accountName || '').toLowerCase();

                const declineRequest =
                    requests.find(
                        (item) =>
                            String(item.account || '').toLowerCase() ===
                            normalizedAccount
                    ) || null;

                this.setState({
                    checkingRequest: false,
                    hasPendingDeclineRequest: !!declineRequest,
                    declineRequest,
                    requestLookupError: null,
                    confirmPermanentDecline: false,
                });
            })
            .catch((error) => {
                if (this.unmounted || lookupSeq !== this.requestLookupSeq) {
                    return;
                }

                this.setState({
                    checkingRequest: false,
                    hasPendingDeclineRequest: false,
                    declineRequest: null,
                    requestLookupError:
                        (error && error.message) ||
                        tt(
                            'steem_tools.decline_voting.error_check_pending_request'
                        ),
                });
            });
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt('steem_tools.decline_voting.unexpected_error');
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess(mode) {
        const { currentUser, refreshAccount } = this.props;

        refreshAccount(currentUser);

        this.setState(
            (prevState) => ({
                loading: false,
                error: null,
                success:
                    mode === 'cancel'
                        ? tt(
                              'steem_tools.decline_voting.cancel_success_message'
                          )
                        : tt('steem_tools.decline_voting.success_message'),
                confirmPermanentDecline: false,
                ...(mode === 'decline'
                    ? {
                          hasPendingDeclineRequest: true,
                          declineRequest: prevState.declineRequest || {
                              effective_date: '',
                              account: currentUser,
                          },
                      }
                    : {}),
                ...(mode === 'cancel'
                    ? {
                          hasPendingDeclineRequest: false,
                          declineRequest: null,
                      }
                    : {}),
            }),
            () => {
                this.loadDeclineRequestStatus(this.props);
            }
        );
    }

    onSubmit() {
        const { currentUser, accountName, declineVotingRights } = this.props;
        const {
            confirmPermanentDecline,
            checkingRequest,
            hasPendingDeclineRequest,
        } = this.state;

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (checkingRequest) {
            this.setState({
                error: tt(
                    'steem_tools.decline_voting.checking_pending_request'
                ),
                success: null,
            });
            return;
        }

        if (hasPendingDeclineRequest) {
            this.setState({
                error: tt(
                    'steem_tools.decline_voting.pending_request_already_exists'
                ),
                success: null,
            });
            return;
        }

        if (!confirmPermanentDecline) {
            this.setState({
                error: tt(
                    'steem_tools.decline_voting.error_confirmation_required'
                ),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        declineVotingRights(
            accountName,
            true,
            () => this.onSuccess('decline'),
            this.onFailure
        );
    }

    onSubmitCancel() {
        const { currentUser, accountName, declineVotingRights } = this.props;
        const { checkingRequest, hasPendingDeclineRequest } = this.state;

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_no_target_account'),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.decline_voting.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (checkingRequest) {
            this.setState({
                error: tt(
                    'steem_tools.decline_voting.checking_pending_request'
                ),
                success: null,
            });
            return;
        }

        if (!hasPendingDeclineRequest) {
            this.setState({
                error: tt(
                    'steem_tools.decline_voting.error_no_pending_request'
                ),
                success: null,
            });
            return;
        }

        this.setState({
            loading: true,
            error: null,
            success: null,
        });

        declineVotingRights(
            accountName,
            false,
            () => this.onSuccess('cancel'),
            this.onFailure
        );
    }

    render() {
        const { currentUser, accountName } = this.props;
        const {
            confirmPermanentDecline,
            loading,
            checkingRequest,
            hasPendingDeclineRequest,
            requestLookupError,
            error,
            success,
        } = this.state;

        const isOwner =
            !!currentUser &&
            !!accountName &&
            currentUser === accountName;

        const canDecline =
            !loading &&
            !checkingRequest &&
            isOwner &&
            confirmPermanentDecline &&
            !hasPendingDeclineRequest;

        const canCancelPending =
            !loading &&
            !checkingRequest &&
            isOwner &&
            hasPendingDeclineRequest;

        const pendingMeta = this.getPendingDeclineMeta();

        const pendingWarningMessage =
            pendingMeta.daysLeft != null
                ? tt('steem_tools.decline_voting.pending_warning_message', {
                      days: pendingMeta.daysLeft,
                      day_label: pendingMeta.dayLabel,
                      account: accountName,
                      effective_date: pendingMeta.effectiveDateText,
                  })
                : tt(
                      'steem_tools.decline_voting.pending_warning_message_no_date',
                      {
                          account: accountName,
                      }
                  );

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">
                            {tt('steem_tools.decline_voting.title')}
                        </h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.decline_voting.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 7 }}>
                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1 flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt('steem_tools.decline_voting.current_account')}
                                </div>
                            </div>
                            <div className="column flex-container-2 flex-mobile-full">
                                <div
                                    className="input-group"
                                    style={{ marginBottom: '1.25rem' }}
                                >
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

                        {checkingRequest && isOwner ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="change-recovery-account-hint">
                                        <span
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                            }}
                                        >
                                            <LoadingIndicator type="circle" />
                                            {tt(
                                                'steem_tools.decline_voting.checking_pending_request'
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!checkingRequest && requestLookupError && isOwner ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {requestLookupError}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!checkingRequest && hasPendingDeclineRequest ? (
                            <div className="row" style={{ marginBottom: '1.25rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {pendingWarningMessage}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="row" style={{ marginBottom: '1.25rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        <FormattedHTMLMessage id="steem_tools.decline_voting.warning_message" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {!hasPendingDeclineRequest ? (
                            <div
                                className="row"
                                style={{ marginTop: '1rem', marginBottom: '1rem' }}
                            >
                                <div className="column toggle_container advtools-acknowledge-check">
                                    <span>
                                        {tt(
                                            'steem_tools.decline_voting.confirmation_label'
                                        )}
                                    </span>
                                    <label className="switch">
                                        <input
                                            type="checkbox"
                                            checked={confirmPermanentDecline}
                                            onChange={this.onCheckboxChange}
                                            disabled={
                                                loading || checkingRequest || !isOwner
                                            }
                                        />
                                        <span className="slider round" />
                                    </label>
                                </div>
                            </div>
                        ) : null}

                        {!loading && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt(
                                            'steem_tools.decline_voting.error_not_allowed'
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {error}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">
                                        {success}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row">
                            <div className="column">
                                {loading ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : hasPendingDeclineRequest ? (
                                    <button
                                        type="button"
                                        className="button advtools-btn-primary"
                                        onClick={this.onSubmitCancel}
                                        disabled={!canCancelPending}
                                    >
                                        {tt(
                                            'steem_tools.decline_voting.cancel_pending_btn'
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        className="button advtools-btn-primary"
                                        onClick={this.onSubmit}
                                        disabled={!canDecline}
                                    >
                                        {tt(
                                            'steem_tools.decline_voting.submit_btn'
                                        )}
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
        declineVotingRights: (
            account,
            decline,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${account}/permissions` }));
                if (successCallback) successCallback();
            };

            const operation = {
                account,
                decline,
            };

            const conf = decline
                ? tt(
                      'steem_tools.decline_voting.confirm_broadcast_message',
                      { account }
                  )
                : tt(
                      'steem_tools.decline_voting.confirm_cancel_broadcast_message',
                      { account }
                  );

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'decline_voting_rights',
                    operation,
                    confirm: conf + '?',
                    confirmTitle: decline ? tt('steem_tools.decline_voting.confirm_decline_voting_rights') : tt('steem_tools.decline_voting.cancel_decline_voting_rights_request'),
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
)(DeclineVoting);
