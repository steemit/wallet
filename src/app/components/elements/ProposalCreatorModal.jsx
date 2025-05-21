import React from 'react';
import ReactModal from 'react-modal';
import moment from 'moment';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import { numberWithCommas } from 'app/utils/StateFunctions';
import Icon from 'app/components/elements/Icon';
import CloseButton from 'app/components/elements/CloseButton';

ReactModal.defaultStyles.overlay.backgroundColor = 'rgba(0, 0, 0, 0.6)';

class ProposalCreatorModal extends React.Component {
    constructor(props) {
        super(props);
        const now = moment().utc();
        this.state = {
            proposalForm: {
                startDate: now.format('YYYY-MM-DDTHH:mm'),
                endDate: now.format('YYYY-MM-DDTHH:mm'),
                title: '',
                permlink: '',
                creator: '', // if we have current user or check from input as user may login with different keychain user
                receiver: '',
                dailyAmount: 0.0,
            },
            treasuryFee: null,
            rawPermlinkInput: '',
        };
    }

    componentDidMount() {
        this.fetchConfig();
    }

    fetchConfig() {
        api.callAsync('database_api.get_config', {})
            .then(res => {
                this.setState({
                    treasuryFee: res.STEEM_TREASURY_FEE
                        ? numberWithCommas(
                              `${(res.STEEM_TREASURY_FEE / 1000).toFixed(3)}`
                          )
                        : 0,
                });
            })
            .catch(err => {
                console.error('Error fetching config:', err);
            });
    }

    handleRawPermlinkInputChange = e => {
        const rawValue = e.target.value.trim();
        const regex = /@([\w.-]+)\/([\w-]+)/;
        const match = rawValue.match(regex);
        let creator = '';
        let permlink = '';
        if (match) {
            creator = match[1];
            permlink = match[2];
        } else {
            permlink = rawValue;
        }
        this.setState(prevState => {
            const currentCreator = prevState.proposalForm.creator;
            const currentReceiver = prevState.proposalForm.receiver;
            return {
                rawPermlinkInput: rawValue,
                proposalForm: {
                    ...prevState.proposalForm,
                    permlink: permlink || prevState.proposalForm.permlink,
                    creator: currentCreator || creator,
                    receiver: currentReceiver || creator,
                },
            };
        });
    };

    handleProposalFormChange = e => {
        const { name, value } = e.target;
        this.setState(prevState => ({
            proposalForm: {
                ...prevState.proposalForm,
                [name]: value,
            },
        }));
    };

    isFormValid() {
        const {
            startDate,
            endDate,
            title,
            permlink,
            creator,
            receiver,
            dailyAmount,
        } = this.state.proposalForm;
        const start = moment(startDate);
        const end = moment(endDate);
        const datesAreValid =
            start.isValid() && end.isValid() && start.isBefore(end);
        const fieldsAreFilled =
            title.trim() !== '' &&
            permlink.trim() !== '' &&
            creator.trim() !== '' &&
            receiver.trim() !== '';
        return datesAreValid && fieldsAreFilled && dailyAmount !== null;
    }

    handleSubmit = e => {
        e.preventDefault();
        const { submit_proposal } = this.props;
        const { proposalForm } = this.state;
        if (
            !proposalForm.creator ||
            !proposalForm.receiver ||
            !proposalForm.dailyAmount ||
            !proposalForm.startDate ||
            !proposalForm.endDate ||
            !proposalForm.permlink ||
            !proposalForm.title
        ) {
            window.alert('Please fill-in all fields!');
        } else {
            submit_proposal(proposalForm);
        }
    };

    render() {
        const { open_modal, close_modal, nightmodeEnabled } = this.props;

        const {
            title,
            creator,
            receiver,
            dailyAmount,
            startDate,
            endDate,
        } = this.state.proposalForm;
        const { treasuryFee, rawPermlinkInput } = this.state;

        return (
            <div className="voters-modal__container">
                <ReactModal
                    isOpen={open_modal}
                    onAfterOpen={() => open_modal}
                    onRequestClose={close_modal}
                    ariaHideApp={false}
                    className={
                        nightmodeEnabled
                            ? 'ProposalCreatorModal__content ProposalCreatorModal__content--night'
                            : 'ProposalCreatorModal__content'
                    }
                >
                    <CloseButton onClick={close_modal} />
                    <div className="row steem-modal">
                        <div className="columns">
                            <form onSubmit={this.handleSubmit}>
                                <h3 className="text-center">
                                    {tt('proposals.create_proposal.header')}
                                </h3>
                                <hr />

                                <label htmlFor="title">
                                    {tt(
                                        'proposals.create_proposal.proposal_title'
                                    )}
                                </label>
                                <input
                                    id="title"
                                    name="title"
                                    value={title}
                                    onChange={this.handleProposalFormChange}
                                    type="text"
                                />
                                <br />

                                <label htmlFor="dailyAmount">
                                    {tt(
                                        'proposals.create_proposal.daily_amount'
                                    )}
                                </label>
                                <input
                                    id="dailyAmount"
                                    name="dailyAmount"
                                    value={dailyAmount}
                                    onChange={this.handleProposalFormChange}
                                    placeholder="100.000"
                                    type="number"
                                    step="0.001"
                                />
                                <br />

                                <label htmlFor="startDate">
                                    {tt('proposals.create_proposal.start_date')}
                                </label>
                                <input
                                    id="startDate"
                                    type="datetime-local"
                                    value={startDate}
                                    name="startDate"
                                    onChange={this.handleProposalFormChange}
                                />
                                <br />

                                <label htmlFor="endDate">
                                    {tt('proposals.create_proposal.end_date')}
                                </label>
                                <input
                                    id="endDate"
                                    type="datetime-local"
                                    value={endDate}
                                    name="endDate"
                                    onChange={this.handleProposalFormChange}
                                />
                                <br />

                                <div className="label-with-tooltip">
                                    <label htmlFor="permlink">
                                        {tt(
                                            'proposals.create_proposal.permlink'
                                        )}
                                    </label>
                                    <div className="info-hover-container">
                                        <Icon name="info" className="info" />
                                        <span className="info-msg">
                                            {tt(
                                                'proposals.create_proposal.permlink_note'
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <input
                                    id="permlink"
                                    name="rawPermlinkInput"
                                    value={rawPermlinkInput}
                                    onChange={this.handleRawPermlinkInputChange}
                                    placeholder={tt(
                                        'proposals.create_proposal.permlink_placeholder'
                                    )}
                                    type="text"
                                />
                                <br />

                                <div className="label-with-tooltip">
                                    <label htmlFor="creator">
                                        {tt(
                                            'proposals.create_proposal.proposal_creator'
                                        )}
                                    </label>
                                    <div className="info-hover-container">
                                        <Icon name="info" className="info" />
                                        <span className="info-msg">
                                            {tt(
                                                'proposals.create_proposal.proposal_creator_note'
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <input
                                    id="creator"
                                    name="creator"
                                    value={creator}
                                    onChange={this.handleProposalFormChange}
                                    type="text"
                                    placeholder={tt(
                                        'proposals.create_proposal.proposal_creator_placeholder'
                                    )}
                                />
                                <br />

                                <div className="label-with-tooltip">
                                    <label>
                                        {tt(
                                            'proposals.create_proposal.proposal_receiver'
                                        )}
                                    </label>
                                    <div className="info-hover-container">
                                        <Icon name="info" className="info" />
                                        <span className="info-msg">
                                            {tt(
                                                'proposals.create_proposal.proposal_receiver_note'
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <input
                                    id="receiver"
                                    name="receiver"
                                    value={receiver}
                                    onChange={this.handleProposalFormChange}
                                    placeholder={tt(
                                        'proposals.create_proposal.proposal_receiver_placeholder'
                                    )}
                                    type="text"
                                />
                                <br />

                                <label>
                                    {tt(
                                        'proposals.create_proposal.creation_fee'
                                    )}
                                </label>
                                <div className="input-wrapper icon-visible-on-hover-focus">
                                    <input
                                        id="creation_fee"
                                        name="creation_fee"
                                        value={`${treasuryFee} SBD`}
                                        type="text"
                                        disabled
                                    />
                                    <span className="input-icon icon-hidden">
                                        <Icon name="forbidden" />
                                    </span>
                                </div>
                                <br />

                                <div className="text-center">
                                    <button
                                        type="submit"
                                        className="button"
                                        disabled={!this.isFormValid()}
                                    >
                                        {tt('proposals.create_proposal.submit')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </ReactModal>
            </div>
        );
    }
}
export default ProposalCreatorModal;
