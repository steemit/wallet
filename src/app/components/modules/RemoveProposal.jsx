import CloseButton from 'app/components/elements/CloseButton';
import Reveal from 'app/components/elements/Reveal';
import { NotificationStack } from 'react-notification';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import React, { Component } from 'react';
import reactForm from 'app/utils/ReactForm';
import tt from 'counterpart';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { FormattedHTMLMessage } from 'app/Translator';
import { connect } from 'react-redux';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';

class RemoveProposal extends Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Modals');
        this.state = {
            loading: false,
        };
        this.initForm(props);
    }

    initForm(props) {
        const { proposalID } = this.props;
        const fields = ['confirm_id'];
        reactForm({
            name: 'remove',
            instance: this,
            fields,
            initialValues: { confirm_id: '' },
            validation: values => {
                return {
                    confirm_id: !values.confirm_id
                        ? tt('g.required')
                        : `${proposalID}` !== values.confirm_id,
                };
            },
        });
    }

    clearError = () => {
        this.setState({ trxError: undefined, tronLoading: false });
    };

    onFailure = () => {
        this.setState({ loading: false });
    };

    removeProposalbtn = ({ confirm_id, onSuccess, onFailure }) => {
        const parsedId = parseInt(confirm_id, 10);
        const removeProposalById = this.props.removeProposalById;
        this.props.removeProposal(
            this.props.currentUser,
            [parsedId],
            async () => {
                if (onSuccess) {
                    if (removeProposalById) {
                        removeProposalById(parsedId);
                    }
                    return onSuccess();
                }
            },
            () => {
                if (onFailure) onFailure();
            }
        );
    };

    render() {
        const { confirm_id } = this.state;

        const { loading } = this.state;
        const {
            proposalID,
            notifications,
            removeNotification,
            show_remove_proposal_modal,
            hideRemoveProposal,
        } = this.props;
        const { submitting, valid, handleSubmit } = this.state.remove;
        const notifications_array = notifications
            ? notifications.toArray().map(n => {
                  n.onClick = () => removeNotification(n.key);
                  return n;
              })
            : [];

        const form = (
            <form
                onSubmit={handleSubmit(({ data }) => {
                    this.setState({ loading: true });
                    this.removeProposalbtn({
                        ...data,
                        onSuccess: hideRemoveProposal,
                        onFailure: this.onFailure,
                    });
                })}
                onChange={this.clearError}
            >
                <div>
                    <div className="row">
                        <div className="column small-12">
                            <FormattedHTMLMessage
                                className="secondary"
                                id="proposals.remove_faq_message"
                            />
                        </div>
                    </div>
                    <br />
                </div>

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('proposals.proposal_id')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">ID</span>
                            <input
                                className="input-group-field bold"
                                type="text"
                                disabled
                                value={proposalID}
                            />
                        </div>
                    </div>
                </div>

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('proposals.proposal_confirm_id')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">ID</span>
                            <input
                                type="number"
                                {...confirm_id.props}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                ref="confirm_id"
                                disabled={loading}
                            />
                        </div>
                    </div>
                </div>

                <div className="row" style={{ marginTop: '1.25rem' }}>
                    <div className="column">
                        {loading && (
                            <span>
                                <LoadingIndicator type="circle" />
                                <br />
                            </span>
                        )}
                        {!loading && (
                            <span>
                                <button
                                    type="submit"
                                    disabled={submitting || !valid}
                                    className="button"
                                >
                                    OK
                                </button>
                            </span>
                        )}
                    </div>
                </div>
            </form>
        );

        return (
            <div>
                {show_remove_proposal_modal && (
                    <Reveal
                        onHide={hideRemoveProposal}
                        show={show_remove_proposal_modal}
                    >
                        <CloseButton onClick={hideRemoveProposal} />
                        <div>
                            <div className="row">
                                <h3 className="column">
                                    {tt('proposals.remove_proposal')}
                                </h3>
                            </div>
                            {form}
                        </div>
                    </Reveal>
                )}
                <NotificationStack
                    style={{}}
                    notifications={notifications_array}
                    onDismiss={n => removeNotification(n.key)}
                />
            </div>
        );
    }
}
export default connect(
    state => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');
        return {
            currentUser,
            notifications: state.app.get('notifications'),
        };
    },
    dispatch => ({
        removeProposal: (
            proposal_owner,
            proposal_ids,
            successCallback,
            onFailure
        ) => {
            dispatch(
                transactionActions.broadcastOperation({
                    type: 'remove_proposal',
                    operation: { proposal_owner, proposal_ids },
                    successCallback,
                    errorCallback: onFailure,
                })
            );
        },
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(RemoveProposal);
