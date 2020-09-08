import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
const styles = {
    step: {
        marginTop: '12px',
        marginLeft: '10%',
        frontSize: '20px',
    },
};

class TronVote extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            if ($STM_Config.tron_host.includes('shasta')) {
                new_window.location = 'https://shasta.tronscan.io/#/sr/votes';
            } else {
                new_window.location = 'https://tronscan.io/#/sr/votes';
            }
            this.props.hideVote();
        };
    }

    render() {
        return (
            <div>
                <div>
                    <h1>{tt('g.tronVote')}</h1>
                    <br />
                    <p>{tt('tron_jsx.content0')}</p>
                    <p>{tt('tron_jsx.content1')}</p>
                    <br />
                    <p>{tt('tron_jsx.content2')}</p>
                    <h4> {tt('tron_jsx.step')} </h4>
                </div>
                <div>
                    <p style={styles.step}> {tt('tron_jsx.step1')}</p>
                    <p style={styles.step}> {tt('tron_jsx.step2')}</p>
                    <p style={styles.step}> {tt('tron_jsx.step3')}</p>
                    <p style={styles.step}> {tt('tron_jsx.step4')}</p>
                    <br />
                </div>
                <button
                    type="submit"
                    className="button"
                    onClick={this.handleSubmit}
                >
                    {tt('tron_jsx.vote_button')}
                </button>
            </div>
        );
    }
}

export default connect(
    state => ({}),
    dispatch => ({
        hideVote: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideVote());
        },
    })
)(TronVote);
